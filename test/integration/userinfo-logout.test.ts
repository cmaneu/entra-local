import { createHash, randomBytes } from 'node:crypto';
import { decodeJwt } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import type { AccessTokenClaims } from '../../src/tokens/claims.js';
import { SEED } from '../../src/store/seed.js';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';

/**
 * Integration tests for feature #9 — UserInfo (`/graph/oidc/userinfo`) and Logout
 * (`/{tenant}/oauth2/v2.0/logout`). Exercises both endpoints in-process via `app.inject`, covering
 * acceptance criteria 1–9 (the real-MSAL browser flow is criterion 10, in the e2e suite).
 */

const T = TEST_TENANT_ID;
const AUTHORIZE_PATH = `/${T}/oauth2/v2.0/authorize`;
const TOKEN_PATH = `/${T}/oauth2/v2.0/token`;
const LOGOUT_PATH = `/${T}/oauth2/v2.0/logout`;
const USERINFO_PATH = '/graph/oidc/userinfo';
const SPA = SEED.appSpaId;
const REDIRECT = SEED.spaRedirectUri;
const SPA_SCOPE = `api://${SPA}/${SEED.spaScopeValue}`;
const GRAPH = 'https://graph.microsoft.com';
const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded' };

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

function s256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function extractSignedState(html: string): string {
  const m = /name="__el_state" value="([^"]*)"/.exec(html);
  if (!m) throw new Error('signed state not found in sign-in page');
  return m[1]!
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function extractReturnToApplicationLink(html: string): string | undefined {
  const m = /href="([^"]+)"[^>]*>\s*Return to application<\/a>/s.exec(html);
  if (!m) return undefined;
  const href = m[1];
  if (!href) return undefined;
  return href.replace(/&amp;/g, '&');
}

interface TokenSet {
  accessToken: string;
  idToken: string;
  /** `el_session=<id>` cookie pair. */
  cookie: string;
  /** The bare session id. */
  sessionId: string;
}

/**
 * Drive the full interactive sign-in + code→token exchange for the SPA and return the issued
 * tokens plus the SSO session cookie. Defaults to an OIDC-only scope so the access token's `aud` is
 * the Graph resource (the UserInfo audience). Pass `scope` to request a resource (api://) audience.
 */
async function signInAndToken(app: TestApp, opts: { scope?: string } = {}): Promise<TokenSet> {
  const verifier = randomBytes(32).toString('base64url');
  const params: Record<string, string> = {
    client_id: SPA,
    response_type: 'code',
    redirect_uri: REDIRECT,
    scope: opts.scope ?? 'openid profile email offline_access',
    code_challenge: s256(verifier),
    code_challenge_method: 'S256',
  };

  const page = await app.inject({
    method: 'GET',
    url: `${AUTHORIZE_PATH}?${new URLSearchParams(params).toString()}`,
  });
  expect(page.statusCode).toBe(200);
  const signedState = extractSignedState(page.body);

  const submit = await app.inject({
    method: 'POST',
    url: AUTHORIZE_PATH,
    headers: FORM_HEADERS,
    payload: form({ __el_state: signedState, __el_user: SEED.userAliceId }),
  });
  expect(submit.statusCode).toBe(302);
  const code = new URL(submit.headers.location as string).searchParams.get('code') ?? '';
  const setCookie = submit.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : (setCookie ?? '')).split(';')[0] ?? '';

  const token = await app.inject({
    method: 'POST',
    url: TOKEN_PATH,
    headers: FORM_HEADERS,
    payload: form({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: SPA,
      code_verifier: verifier,
    }),
  });
  expect(token.statusCode).toBe(200);
  const body = token.json() as { access_token: string; id_token: string };
  return {
    accessToken: body.access_token,
    idToken: body.id_token,
    cookie,
    sessionId: cookie.split('=')[1] ?? '',
  };
}

/** Mint an app-only (client-credentials) Graph-audience token via the daemon app (no `oid`). */
async function appOnlyGraphToken(app: TestApp): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: TOKEN_PATH,
    headers: FORM_HEADERS,
    payload: form({
      grant_type: 'client_credentials',
      client_id: SEED.appDaemonId,
      client_secret: SEED.daemonSecret,
      scope: `${GRAPH}/.default`,
    }),
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { access_token: string }).access_token;
}

async function getUserInfo(
  app: TestApp,
  bearer: string | undefined,
  method: 'GET' | 'POST' = 'GET',
) {
  return await app.inject({
    method,
    url: USERINFO_PATH,
    headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
  });
}

// ---------------------------------------------------------------------------
// Criterion 1 & 2 — UserInfo happy path + sub correlation with the ID token
// ---------------------------------------------------------------------------
describe('UserInfo happy path (criteria 1, 2)', () => {
  it('returns the OIDC claim set with Cache-Control: no-store', async () => {
    ctx = await buildTestApp();
    const tokens = await signInAndToken(ctx);
    const res = await getUserInfo(ctx, tokens.accessToken);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['cache-control']).toContain('no-store');

    const body = res.json() as Record<string, unknown>;
    const accessSub = decodeJwt(tokens.accessToken).sub;
    expect(body.sub).toBe(accessSub);
    expect(body.oid).toBe(SEED.userAliceId);
    expect(body.tid).toBe(T);
    expect(body.name).toBe('Alice Example');
    expect(body.preferred_username).toBe('alice@entralocal.dev');
    expect(body.given_name).toBe('Alice');
    expect(body.family_name).toBe('Example');
    expect(body.email).toBe('alice@entralocal.dev');
  });

  it("sub equals the ID token's sub for the same (user, app)", async () => {
    ctx = await buildTestApp();
    const tokens = await signInAndToken(ctx);
    const res = await getUserInfo(ctx, tokens.accessToken);
    const body = res.json() as { sub: string };
    expect(body.sub).toBe(decodeJwt(tokens.idToken).sub);
  });

  it('omits given_name/family_name/email when the user has no value', async () => {
    ctx = await buildTestApp();
    // Strip Alice's optional profile fields, then sign in + fetch.
    ctx.app.store.users.update(SEED.userAliceId, { givenName: null, surname: null, mail: null });
    const tokens = await signInAndToken(ctx);
    const body = (await getUserInfo(ctx, tokens.accessToken)).json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('given_name');
    expect(body).not.toHaveProperty('family_name');
    expect(body).not.toHaveProperty('email');
    expect(body.name).toBe('Alice Example');
  });
});

// ---------------------------------------------------------------------------
// Criterion 3 — UserInfo 401s (missing / tampered / expired / wrong-audience)
// ---------------------------------------------------------------------------
describe('UserInfo 401 (criterion 3)', () => {
  function expect401(res: {
    statusCode: number;
    headers: Record<string, unknown>;
    json: () => unknown;
  }) {
    expect(res.statusCode).toBe(401);
    expect(String(res.headers['www-authenticate'])).toContain('Bearer error="invalid_token"');
    const body = res.json() as { error: string; error_description: string };
    expect(body.error).toBe('invalid_token');
    expect(body.error_description).toBeTruthy();
  }

  it('missing Bearer → 401', async () => {
    ctx = await buildTestApp();
    expect401(await getUserInfo(ctx, undefined));
  });

  it('tampered signature → 401', async () => {
    ctx = await buildTestApp();
    const tokens = await signInAndToken(ctx);
    const parts = tokens.accessToken.split('.');
    const sig = parts[2]!;
    // Flip the first (fully significant) signature char so the change always invalidates the
    // signature. Flipping the last char is unreliable: a 2048-bit RSA signature's final base64url
    // char carries only 2 significant bits, so an A↔B swap frequently decodes identically.
    parts[2] = (sig.startsWith('A') ? 'B' : 'A') + sig.slice(1);
    expect401(await getUserInfo(ctx, parts.join('.')));
  });

  it('expired token → 401', async () => {
    ctx = await buildTestApp();
    const now = Math.floor(Date.now() / 1000);
    const claims: AccessTokenClaims = {
      iss: ctx.config.issuer,
      sub: 'expired-sub',
      aud: ctx.config.graphResourceId,
      exp: now - 1000,
      iat: now - 4600,
      nbf: now - 4600,
      tid: T,
      azp: SPA,
      appid: SPA,
      oid: SEED.userAliceId,
      scp: '',
      ver: '2.0',
    };
    const expired = await ctx.app.tokenService.mintAccessToken(T, claims);
    expect401(await getUserInfo(ctx, expired));
  });

  it('wrong-audience token (resource api:// audience) → 401', async () => {
    ctx = await buildTestApp();
    // Requesting the SPA's api:// scope yields an access token whose aud is the SPA appId.
    const tokens = await signInAndToken(ctx, {
      scope: `openid profile offline_access ${SPA_SCOPE}`,
    });
    expect(decodeJwt(tokens.accessToken).aud).toBe(SPA);
    expect401(await getUserInfo(ctx, tokens.accessToken));
  });
});

// ---------------------------------------------------------------------------
// Criterion 4 — app-only token → 403 insufficient_scope
// ---------------------------------------------------------------------------
describe('UserInfo app-only 403 (criterion 4)', () => {
  it('an app-only client-credentials token (no oid) → 403 insufficient_scope', async () => {
    ctx = await buildTestApp();
    const appToken = await appOnlyGraphToken(ctx);
    expect(decodeJwt(appToken).oid).toBeUndefined();
    const res = await getUserInfo(ctx, appToken);
    expect(res.statusCode).toBe(403);
    expect(String(res.headers['www-authenticate'])).toContain('Bearer error="insufficient_scope"');
    const body = res.json() as { error: string; error_description: string };
    expect(body.error).toBe('insufficient_scope');
    expect(body.error_description).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Criterion 5 — POST parity
// ---------------------------------------------------------------------------
describe('UserInfo POST parity (criterion 5)', () => {
  it('POST behaves identically to GET', async () => {
    ctx = await buildTestApp();
    const tokens = await signInAndToken(ctx);
    const get = await getUserInfo(ctx, tokens.accessToken, 'GET');
    const post = await getUserInfo(ctx, tokens.accessToken, 'POST');
    expect(post.statusCode).toBe(get.statusCode);
    expect(post.json()).toEqual(get.json());
    expect(post.headers['cache-control']).toContain('no-store');
  });

  it('POST without a Bearer → 401 (matching GET)', async () => {
    ctx = await buildTestApp();
    const res = await getUserInfo(ctx, undefined, 'POST');
    expect(res.statusCode).toBe(401);
    expect(String(res.headers['www-authenticate'])).toContain('invalid_token');
  });
});

// ---------------------------------------------------------------------------
// Criterion 6 — logout clears the session + expires the cookie
// ---------------------------------------------------------------------------
describe('Logout clears session (criterion 6)', () => {
  it('deletes the sessions row, expires the cookie, and renders the signed-out page', async () => {
    ctx = await buildTestApp();
    const tokens = await signInAndToken(ctx);
    expect(ctx.app.store.sessions.get(tokens.sessionId)).toBeDefined();

    const res = await ctx.inject({
      method: 'GET',
      url: LOGOUT_PATH,
      headers: { cookie: tokens.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('signed out');

    // The session row is gone and the cookie is expired.
    expect(ctx.app.store.sessions.get(tokens.sessionId)).toBeUndefined();
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie ?? '');
    expect(cookieStr).toContain('el_session=');
    expect(cookieStr.toLowerCase()).toMatch(/expires=|max-age=0/);
  });
});

// ---------------------------------------------------------------------------
// Criterion 7 — logout redirect validation
// ---------------------------------------------------------------------------
describe('Logout redirect validation (criterion 7)', () => {
  function logout(app: TestApp, query: Record<string, string>) {
    return app.inject({
      method: 'GET',
      url: `${LOGOUT_PATH}?${new URLSearchParams(query).toString()}`,
    });
  }

  it('registered post_logout_redirect_uri + client_id → signed-out page with return link echoing state', async () => {
    ctx = await buildTestApp();
    const res = await logout(ctx, {
      post_logout_redirect_uri: REDIRECT,
      client_id: SPA,
      state: 'xyz-123',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBeUndefined();
    const href = extractReturnToApplicationLink(res.body);
    expect(href).toBeTruthy();
    const loc = new URL(href as string);
    expect(`${loc.origin}${loc.pathname}`.replace(/\/$/, '')).toBe(REDIRECT);
    expect(loc.searchParams.get('state')).toBe('xyz-123');
  });

  it('resolves client_id from id_token_hint when client_id param is absent → signed-out page with return link', async () => {
    ctx = await buildTestApp();
    const tokens = await signInAndToken(ctx);
    const res = await logout(ctx, {
      post_logout_redirect_uri: REDIRECT,
      id_token_hint: tokens.idToken,
    });
    expect(res.statusCode).toBe(200);
    const href = extractReturnToApplicationLink(res.body);
    expect((href ?? '').startsWith(REDIRECT)).toBe(true);
  });

  it('unregistered post_logout_redirect_uri → no redirect, signed-out page', async () => {
    ctx = await buildTestApp();
    const res = await logout(ctx, {
      post_logout_redirect_uri: 'https://evil.example/callback',
      client_id: SPA,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toContain('signed out');
    expect(res.body).not.toContain('Return to application');
  });

  it('missing/unresolvable client_id with a redirect uri → signed-out page (no open redirect)', async () => {
    ctx = await buildTestApp();
    const res = await logout(ctx, { post_logout_redirect_uri: REDIRECT });
    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).not.toContain('Return to application');
  });
});

// ---------------------------------------------------------------------------
// Criterion 8 — logout idempotency
// ---------------------------------------------------------------------------
describe('Logout idempotent (criterion 8)', () => {
  it('no session cookie → still 200 + clears the cookie', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({ method: 'GET', url: LOGOUT_PATH });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie ?? '');
    expect(cookieStr).toContain('el_session=');
  });

  it('invalid session cookie → still 200', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'GET',
      url: LOGOUT_PATH,
      headers: { cookie: 'el_session=not-a-real-session' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('signed out');
  });
});

// ---------------------------------------------------------------------------
// Criterion 9 — discovery lockstep
// ---------------------------------------------------------------------------
describe('Discovery lockstep (criterion 9)', () => {
  it('userinfo_endpoint/end_session_endpoint resolve to the #9 handlers (not 501 stubs)', async () => {
    ctx = await buildTestApp();
    const disc = await ctx.inject({
      method: 'GET',
      url: `/${T}/v2.0/.well-known/openid-configuration`,
    });
    const doc = disc.json() as {
      userinfo_endpoint: string;
      end_session_endpoint: string;
    } & Record<string, unknown>;

    // UserInfo: real handler returns 401 (no bearer), never the 501 reserved stub.
    const ui = await ctx.inject({
      method: 'GET',
      url: new URL(doc.userinfo_endpoint).pathname,
    });
    expect(ui.statusCode).toBe(401);

    // Logout: real handler renders the signed-out page (200), never the 501 reserved stub.
    const lo = await ctx.inject({
      method: 'GET',
      url: new URL(doc.end_session_endpoint).pathname,
    });
    expect(lo.statusCode).toBe(200);
    expect(lo.headers['content-type']).toContain('text/html');

    // No unimplemented front-channel capabilities are advertised.
    expect(doc).not.toHaveProperty('frontchannel_logout_supported');
    expect(doc).not.toHaveProperty('http_logout_supported');
  });
});
