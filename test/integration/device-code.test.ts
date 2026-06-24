import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256 } from '../../src/store/hashing.js';
import { SEED } from '../../src/store/seed.js';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';

/**
 * Integration tests for feature #15 — Device Code flow (RFC 8628). Exercises the device
 * authorization endpoint, the `device_code` polling grant, and the human approval page in-process
 * via `app.inject`. The real-MSAL flow (criterion 19) lives in the e2e suite.
 */

const T = TEST_TENANT_ID;
const DEVICECODE_PATH = `/${T}/oauth2/v2.0/devicecode`;
const VERIFY_PATH = `/${T}/oauth2/v2.0/devicecode/verify`;
const TOKEN_PATH = `/${T}/oauth2/v2.0/token`;
const JWKS_PATH = `/${T}/discovery/v2.0/keys`;
const SPA = SEED.appSpaId;
const SPA_SCOPE = `api://${SPA}/${SEED.spaScopeValue}`;
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const USER_CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded' };

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

/** Form-encode a record for an `application/x-www-form-urlencoded` body. */
function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
  message: string;
}

/** Call the device-authorization endpoint and return the parsed JSON + status. */
async function deviceAuthorize(
  app: TestApp,
  fields: Record<string, string>,
): Promise<{ status: number; headers: Record<string, unknown>; json: DeviceAuthResponse }> {
  const res = await app.inject({
    method: 'POST',
    url: DEVICECODE_PATH,
    headers: FORM_HEADERS,
    payload: form(fields),
  });
  return { status: res.statusCode, headers: res.headers, json: res.json() as DeviceAuthResponse };
}

/** Poll the token endpoint with the device_code grant. */
async function poll(
  app: TestApp,
  fields: Record<string, string>,
): Promise<Awaited<ReturnType<TestApp['inject']>>> {
  return app.inject({
    method: 'POST',
    url: TOKEN_PATH,
    headers: FORM_HEADERS,
    payload: form({ grant_type: DEVICE_GRANT, ...fields }),
  });
}

/** A standard pending device code for the SPA with the given scope. */
async function newDeviceCode(app: TestApp, scope: string): Promise<DeviceAuthResponse> {
  const { json } = await deviceAuthorize(app, { client_id: SPA, scope });
  return json;
}

/** Extract a `__el_state` hidden field from a rendered page (un-escaping the value). */
function extractState(html: string): string {
  const m = /name="__el_state" value="([^"]*)"/.exec(html);
  if (!m) throw new Error('signed state not found');
  return m[1]!
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

/** First Set-Cookie value's name=value pair (the integration cookie-ordering contract). */
function firstCookie(res: Awaited<ReturnType<TestApp['inject']>>): string {
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0]! : (setCookie ?? '');
  return raw.split(';')[0] ?? '';
}

// ---------------------------------------------------------------------------
// Criterion 1 — device authorization endpoint shape
// ---------------------------------------------------------------------------
describe('device authorization endpoint (criterion 1)', () => {
  it('returns the RFC 8628 JSON + persists a hashed pending row', async () => {
    ctx = await buildTestApp();
    const { status, headers, json } = await deviceAuthorize(ctx, {
      client_id: SPA,
      scope: 'openid profile offline_access',
    });

    expect(status).toBe(200);
    expect(headers['cache-control']).toBe('no-store');
    expect(json.device_code.length).toBeGreaterThan(0);
    expect(json.user_code).toMatch(USER_CODE_RE);
    expect(json.verification_uri.endsWith('/oauth2/v2.0/devicecode')).toBe(true);
    expect(json.verification_uri_complete).toContain('?user_code=');
    expect(json.expires_in).toBe(900);
    expect(json.interval).toBe(5);
    expect(typeof json.message).toBe('string');

    // Stored row: status=pending, device_code column = SHA-256 hash (never the plaintext).
    const row = ctx.app.store.deviceCodes.getByUserCode(json.user_code);
    expect(row).toBeDefined();
    expect(row!.status).toBe('pending');
    expect(row!.deviceCode).toBe(sha256(json.device_code));
    expect(row!.deviceCode).not.toBe(json.device_code);
  });

  it('echoes the request tenant alias in the verification_uri', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'POST',
      url: `/common/oauth2/v2.0/devicecode`,
      headers: FORM_HEADERS,
      payload: form({ client_id: SPA, scope: 'openid' }),
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as DeviceAuthResponse;
    expect(json.verification_uri).toContain('/common/oauth2/v2.0/devicecode');
  });
});

// ---------------------------------------------------------------------------
// Criterion 2/3 — scope + client validation
// ---------------------------------------------------------------------------
describe('device authorization validation (criteria 2, 3)', () => {
  it('missing/empty scope → invalid_scope (400)', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'POST',
      url: DEVICECODE_PATH,
      headers: FORM_HEADERS,
      payload: form({ client_id: SPA }),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_scope');
  });

  it('an unregistered resource scope → invalid_scope (400)', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'POST',
      url: DEVICECODE_PATH,
      headers: FORM_HEADERS,
      payload: form({ client_id: SPA, scope: 'api://cccccccc-0000-0000-0000-00000000dead/x' }),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_scope');
  });

  it('unknown client_id → invalid_client (401)', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'POST',
      url: DEVICECODE_PATH,
      headers: FORM_HEADERS,
      payload: form({ client_id: 'cccccccc-0000-0000-0000-00000000dead', scope: 'openid' }),
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe('invalid_client');
  });

  it('public SPA presenting a client_secret → invalid_client (401)', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'POST',
      url: DEVICECODE_PATH,
      headers: FORM_HEADERS,
      payload: form({ client_id: SPA, client_secret: 'nope', scope: 'openid' }),
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe('invalid_client');
  });
});

// ---------------------------------------------------------------------------
// Criteria 4-11 — polling
// ---------------------------------------------------------------------------
describe('device_code polling grant (criteria 4-11)', () => {
  it('polling before approval → 400 authorization_pending (criterion 4)', async () => {
    ctx = await buildTestApp();
    const da = await newDeviceCode(ctx, 'openid profile offline_access');
    const res = await poll(ctx, { device_code: da.device_code, client_id: SPA });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('authorization_pending');
  });

  it('after approval → 200 token set with openid/offline_access gating (criterion 5)', async () => {
    ctx = await buildTestApp();
    const da = await newDeviceCode(ctx, 'openid profile offline_access');
    ctx.app.store.deviceCodes.approve(da.user_code, SEED.userAliceId);

    const res = await poll(ctx, { device_code: da.device_code, client_id: SPA });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json() as { id_token?: string; refresh_token?: string; client_info?: string };
    expect(body.id_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
    expect(body.client_info).toBeTruthy();
  });

  it('omits id_token/refresh_token when openid/offline_access are absent (criterion 5)', async () => {
    ctx = await buildTestApp();
    const da = await newDeviceCode(ctx, SPA_SCOPE);
    ctx.app.store.deviceCodes.approve(da.user_code, SEED.userAliceId);

    const res = await poll(ctx, { device_code: da.device_code, client_id: SPA });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id_token?: string; refresh_token?: string };
    expect(body.id_token).toBeUndefined();
    expect(body.refresh_token).toBeUndefined();
  });

  // Interop divergence: `@azure/msal-node` (GrantType.DEVICE_CODE_GRANT) polls with the bare
  // `device_code` grant value rather than the RFC 8628 URN. We accept both aliases.
  it('accepts the bare `device_code` grant alias (real-MSAL interop)', async () => {
    ctx = await buildTestApp();
    const da = await newDeviceCode(ctx, SPA_SCOPE);
    ctx.app.store.deviceCodes.approve(da.user_code, SEED.userAliceId);

    const res = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({ grant_type: 'device_code', device_code: da.device_code, client_id: SPA }),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { access_token?: string }).access_token).toBeTruthy();
  });

  it('single-use: a second poll after success → 400 invalid_grant, row gone (criterion 6)', async () => {
    ctx = await buildTestApp();
    const da = await newDeviceCode(ctx, 'openid offline_access');
    ctx.app.store.deviceCodes.approve(da.user_code, SEED.userAliceId);

    const first = await poll(ctx, { device_code: da.device_code, client_id: SPA });
    expect(first.statusCode).toBe(200);
    const second = await poll(ctx, { device_code: da.device_code, client_id: SPA });
    expect(second.statusCode).toBe(400);
    expect((second.json() as { error: string }).error).toBe('invalid_grant');
    expect(ctx.app.store.deviceCodes.getByDeviceCodeHash(sha256(da.device_code))).toBeUndefined();
  });

  it('concurrent redemption: exactly one 200, the other invalid_grant (criterion 7)', async () => {
    ctx = await buildTestApp();
    const da = await newDeviceCode(ctx, 'openid');
    ctx.app.store.deviceCodes.approve(da.user_code, SEED.userAliceId);

    const [a, b] = await Promise.all([
      poll(ctx, { device_code: da.device_code, client_id: SPA }),
      poll(ctx, { device_code: da.device_code, client_id: SPA }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 400]);
    const failure = a.statusCode === 400 ? a : b;
    expect((failure.json() as { error: string }).error).toBe('invalid_grant');
    expect(ctx.app.store.deviceCodes.getByDeviceCodeHash(sha256(da.device_code))).toBeUndefined();
  });

  it('tolerates extra MSAL poll params; scopes come solely from the stored row (criterion 8)', async () => {
    ctx = await buildTestApp();
    const da = await newDeviceCode(ctx, `openid ${SPA_SCOPE}`);
    ctx.app.store.deviceCodes.approve(da.user_code, SEED.userAliceId);

    const res = await poll(ctx, {
      device_code: da.device_code,
      client_id: SPA,
      scope: 'User.Read', // stray scope — must be ignored
      client_info: '1',
      'x-client-SKU': 'MSAL.node',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { scope: string };
    expect(body.scope).toContain(SPA_SCOPE);
    expect(body.scope).not.toContain('User.Read');
  });

  it('denied → 400 access_denied (criterion 9)', async () => {
    ctx = await buildTestApp();
    const da = await newDeviceCode(ctx, 'openid');
    ctx.app.store.deviceCodes.deny(da.user_code);
    const res = await poll(ctx, { device_code: da.device_code, client_id: SPA });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('access_denied');
  });

  it('expired → 400 expired_token, row deleted (criterion 10)', async () => {
    ctx = await buildTestApp();
    const da = await newDeviceCode(ctx, 'openid');
    // Force expiry in the past.
    ctx.app.store.db
      .prepare('UPDATE device_codes SET expires_at = ? WHERE user_code = ?')
      .run(1, da.user_code);
    const res = await poll(ctx, { device_code: da.device_code, client_id: SPA });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('expired_token');
    expect(ctx.app.store.deviceCodes.getByDeviceCodeHash(sha256(da.device_code))).toBeUndefined();
  });

  it('binding / unknown / missing device_code (criterion 11)', async () => {
    ctx = await buildTestApp();
    const da = await newDeviceCode(ctx, 'openid');

    // Different client than the device code's app_id → invalid_grant (after authenticating as the
    // confidential daemon client with its seeded secret).
    const mismatch = await poll(ctx, {
      device_code: da.device_code,
      client_id: SEED.appDaemonId,
      client_secret: SEED.daemonSecret,
    });
    expect(mismatch.statusCode).toBe(400);
    expect((mismatch.json() as { error: string }).error).toBe('invalid_grant');

    // Unknown device_code → invalid_grant.
    const unknown = await poll(ctx, { device_code: 'not-a-real-code', client_id: SPA });
    expect(unknown.statusCode).toBe(400);
    expect((unknown.json() as { error: string }).error).toBe('invalid_grant');

    // Missing device_code → invalid_request.
    const missing = await poll(ctx, { client_id: SPA });
    expect(missing.statusCode).toBe(400);
    expect((missing.json() as { error: string }).error).toBe('invalid_request');
  });
});

// ---------------------------------------------------------------------------
// Criteria 12-16 — approval page
// ---------------------------------------------------------------------------
describe('device approval page (criteria 12-16)', () => {
  it('GET renders the code-entry page; ?user_code pre-fills it (criterion 12)', async () => {
    ctx = await buildTestApp();
    const blank = await ctx.inject({ method: 'GET', url: DEVICECODE_PATH });
    expect(blank.statusCode).toBe(200);
    expect(blank.headers['content-type']).toContain('text/html');
    expect(blank.body).toContain('name="user_code"');
    expect(blank.body).toContain('Enter code');

    const prefilled = await ctx.inject({
      method: 'GET',
      url: `${DEVICECODE_PATH}?user_code=BCDF-GHJK`,
    });
    expect(prefilled.body).toContain('value="BCDF-GHJK"');
  });

  it('authenticated lookup renders consent with a session-bound __el_state (criterion 13)', async () => {
    ctx = await buildTestApp();
    const da = await newDeviceCode(ctx, `openid ${SPA_SCOPE}`);
    const session = ctx.app.store.sessions.create({
      userId: SEED.userAliceId,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    const res = await ctx.inject({
      method: 'POST',
      url: VERIFY_PATH,
      headers: { ...FORM_HEADERS, cookie: `el_session=${session.id}` },
      payload: form({ __el_step: 'lookup', user_code: da.user_code }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Approve sign-in');
    expect(res.body).toContain('Sample SPA');
    expect(res.body).toContain(SPA_SCOPE);
    // The signed state binds to the live session id.
    expect(extractState(res.body).length).toBeGreaterThan(0);
  });

  it('decide=approve flips the row + renders success; sid mismatch is rejected (criterion 14)', async () => {
    ctx = await buildTestApp();
    const da = await newDeviceCode(ctx, 'openid');
    const session = ctx.app.store.sessions.create({
      userId: SEED.userAliceId,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    const cookie = `el_session=${session.id}`;

    const consent = await ctx.inject({
      method: 'POST',
      url: VERIFY_PATH,
      headers: { ...FORM_HEADERS, cookie },
      payload: form({ __el_step: 'lookup', user_code: da.user_code }),
    });
    const goodState = extractState(consent.body);

    // A decide with a state signed for a *different* session id (here: no live session match) is a
    // CSRF rejection. Simulate by submitting the good state but WITHOUT the session cookie.
    const noSession = await ctx.inject({
      method: 'POST',
      url: VERIFY_PATH,
      headers: FORM_HEADERS,
      payload: form({ __el_step: 'decide', __el_decision: 'approve', __el_state: goodState }),
    });
    expect(noSession.statusCode).toBe(200);
    expect(noSession.body).not.toContain('all set');
    expect(ctx.app.store.deviceCodes.getByUserCode(da.user_code)!.status).toBe('pending');

    // The proper approve (matching sid) succeeds.
    const approve = await ctx.inject({
      method: 'POST',
      url: VERIFY_PATH,
      headers: { ...FORM_HEADERS, cookie },
      payload: form({ __el_step: 'decide', __el_decision: 'approve', __el_state: goodState }),
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.body).toContain('all set');
    const row = ctx.app.store.deviceCodes.getByUserCode(da.user_code)!;
    expect(row.status).toBe('approved');
    expect(row.userId).toBe(SEED.userAliceId);
  });

  it('not-found / expired / already-used lookup error pages (criterion 15)', async () => {
    ctx = await buildTestApp();

    const notFound = await ctx.inject({
      method: 'POST',
      url: VERIFY_PATH,
      headers: FORM_HEADERS,
      payload: form({ __el_step: 'lookup', user_code: 'ZZZZ-ZZZZ' }),
    });
    expect(notFound.statusCode).toBe(200);
    expect(notFound.body).toContain('found');

    const da = await newDeviceCode(ctx, 'openid');
    ctx.app.store.db
      .prepare('UPDATE device_codes SET expires_at = ? WHERE user_code = ?')
      .run(1, da.user_code);
    const expired = await ctx.inject({
      method: 'POST',
      url: VERIFY_PATH,
      headers: FORM_HEADERS,
      payload: form({ __el_step: 'lookup', user_code: da.user_code }),
    });
    expect(expired.body).toContain('expired');

    const da2 = await newDeviceCode(ctx, 'openid');
    ctx.app.store.deviceCodes.deny(da2.user_code);
    const denied = await ctx.inject({
      method: 'POST',
      url: VERIFY_PATH,
      headers: FORM_HEADERS,
      payload: form({ __el_step: 'lookup', user_code: da2.user_code }),
    });
    expect(denied.body).toContain('denied');
  });

  it('unauthenticated lookup → signin → consent → approve, el_session is Set-Cookie[0] (criterion 16)', async () => {
    ctx = await buildTestApp();
    const da = await newDeviceCode(ctx, 'openid');

    // Unauthenticated lookup renders the account picker.
    const lookup = await ctx.inject({
      method: 'POST',
      url: VERIFY_PATH,
      headers: FORM_HEADERS,
      payload: form({ __el_step: 'lookup', user_code: da.user_code }),
    });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.body).toContain('name="__el_user"');
    const signinState = extractState(lookup.body);

    // Submit the account-picker selection (Alice).
    const signin = await ctx.inject({
      method: 'POST',
      url: VERIFY_PATH,
      headers: FORM_HEADERS,
      payload: form({
        __el_step: 'signin',
        __el_state: signinState,
        __el_user: SEED.userAliceId,
        user_code: da.user_code,
      }),
    });
    expect(signin.statusCode).toBe(200);
    expect(signin.body).toContain('Approve sign-in');
    // Cookie-ordering invariant: el_session is the first Set-Cookie.
    expect(firstCookie(signin)).toMatch(/^el_session=/);
    const cookie = firstCookie(signin);
    const consentState = extractState(signin.body);

    // Approve completes.
    const approve = await ctx.inject({
      method: 'POST',
      url: VERIFY_PATH,
      headers: { ...FORM_HEADERS, cookie },
      payload: form({ __el_step: 'decide', __el_decision: 'approve', __el_state: consentState }),
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.body).toContain('all set');
    expect(ctx.app.store.deviceCodes.getByUserCode(da.user_code)!.status).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// Criterion 17 — token conformance
// ---------------------------------------------------------------------------
describe('device_code token conformance (criterion 17)', () => {
  it('the approved-flow tokens verify against JWKS and carry the approver claims', async () => {
    ctx = await buildTestApp();
    const da = await newDeviceCode(ctx, `openid profile offline_access ${SPA_SCOPE}`);
    ctx.app.store.deviceCodes.approve(da.user_code, SEED.userAliceId);

    const res = await poll(ctx, { device_code: da.device_code, client_id: SPA });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { access_token: string; id_token: string };

    const jwksRes = await ctx.inject({ method: 'GET', url: JWKS_PATH });
    const jwks = createLocalJWKSet(jwksRes.json() as JSONWebKeySet);

    const access = await jwtVerify(body.access_token, jwks);
    expect(access.payload.oid).toBe(SEED.userAliceId);
    const scp = access.payload.scp as string;
    expect(scp).toContain(SEED.spaScopeValue);

    const id = await jwtVerify(body.id_token, jwks);
    expect(id.payload.oid).toBe(SEED.userAliceId);
    expect(id.payload.preferred_username).toBe('alice@entralocal.dev');
  });
});
