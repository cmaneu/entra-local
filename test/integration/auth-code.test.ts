import { createHash, randomBytes } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { SEED } from '../../src/store/seed.js';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';

/**
 * Integration tests for feature #6 — Authorization Code + PKCE + interactive sign-in.
 * Exercises the `/authorize` and `/token` endpoints in-process via `app.inject`, covering the
 * functional acceptance criteria (1–9, 11). The real-browser MSAL flow (criterion 10) lives in the
 * e2e suite.
 */

const T = TEST_TENANT_ID;
const AUTHORIZE_PATH = `/${T}/oauth2/v2.0/authorize`;
const TOKEN_PATH = `/${T}/oauth2/v2.0/token`;
const SPA = SEED.appSpaId;
const REDIRECT = SEED.spaRedirectUri;
const SPA_SCOPE = `api://${SPA}/${SEED.spaScopeValue}`;

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

/** Base64url SHA-256 PKCE challenge for a verifier. */
function s256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** Form-encode a record for an `application/x-www-form-urlencoded` body. */
function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded' };

/** Build an authorize query string from a param record. */
function authorizeUrl(params: Record<string, string>): string {
  return `${AUTHORIZE_PATH}?${new URLSearchParams(params).toString()}`;
}

/** Extract the signed `__el_state` hidden field from a rendered sign-in page. */
function extractSignedState(html: string): string {
  const m = /name="__el_state" value="([^"]*)"/.exec(html);
  if (!m) throw new Error('signed state not found in sign-in page');
  return m[1]!
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

interface SignInResult {
  code: string;
  state: string | null;
  location: string;
  cookie: string;
}

/**
 * Drive the full interactive account-picker flow for the SPA app and return the issued code +
 * session cookie. Uses S256 PKCE by default.
 */
async function signInAndGetCode(
  app: TestApp,
  opts: {
    scope?: string;
    state?: string;
    nonce?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    userId?: string;
  } = {},
): Promise<SignInResult> {
  const params: Record<string, string> = {
    client_id: SPA,
    response_type: 'code',
    redirect_uri: REDIRECT,
    scope: opts.scope ?? `openid profile offline_access ${SPA_SCOPE}`,
  };
  if (opts.state) params.state = opts.state;
  if (opts.nonce) params.nonce = opts.nonce;
  if (opts.codeChallenge) {
    params.code_challenge = opts.codeChallenge;
    params.code_challenge_method = opts.codeChallengeMethod ?? 'S256';
  }

  const page = await app.inject({ method: 'GET', url: authorizeUrl(params) });
  expect(page.statusCode).toBe(200);
  const signedState = extractSignedState(page.body);

  const submit = await app.inject({
    method: 'POST',
    url: AUTHORIZE_PATH,
    headers: FORM_HEADERS,
    payload: form({ __el_state: signedState, __el_user: opts.userId ?? SEED.userAliceId }),
  });
  expect(submit.statusCode).toBe(302);
  const location = submit.headers.location as string;
  const url = new URL(location);
  const setCookie = submit.headers['set-cookie'];
  const cookie = Array.isArray(setCookie) ? setCookie[0]! : (setCookie ?? '');
  return {
    code: url.searchParams.get('code') ?? '',
    state: url.searchParams.get('state'),
    location,
    cookie: cookie.split(';')[0] ?? '',
  };
}

// ---------------------------------------------------------------------------
// Criterion 1 — authorize validation (no-redirect error page vs redirect-with-error)
// ---------------------------------------------------------------------------
describe('authorize validation (criterion 1)', () => {
  it('missing client_id renders a 400 error page and does NOT redirect', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'GET',
      url: authorizeUrl({ response_type: 'code', redirect_uri: REDIRECT, scope: 'openid' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers.location).toBeUndefined();
  });

  it('unknown client_id renders a 400 error page (no redirect)', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'GET',
      url: authorizeUrl({
        client_id: 'cccccccc-0000-0000-0000-00000000dead',
        response_type: 'code',
        redirect_uri: REDIRECT,
        scope: 'openid',
      }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers.location).toBeUndefined();
  });

  it('unregistered redirect_uri renders a 400 error page (no redirect — open-redirect protection)', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'GET',
      url: authorizeUrl({
        client_id: SPA,
        response_type: 'code',
        redirect_uri: 'https://evil.example/callback',
        scope: 'openid',
        code_challenge: s256('v'),
        code_challenge_method: 'S256',
      }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers.location).toBeUndefined();
  });

  it('unsupported response_type with a valid redirect_uri redirects back with error + state', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'GET',
      url: authorizeUrl({
        client_id: SPA,
        response_type: 'token',
        redirect_uri: REDIRECT,
        scope: 'openid',
        state: 'xyz',
        code_challenge: s256('v'),
        code_challenge_method: 'S256',
      }),
    });
    expect(res.statusCode).toBe(302);
    const url = new URL(res.headers.location as string);
    expect(url.searchParams.get('error')).toBe('unsupported_response_type');
    expect(url.searchParams.get('state')).toBe('xyz');
  });

  it('invalid (unregistered) scope with a valid redirect_uri redirects back with invalid_scope', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'GET',
      url: authorizeUrl({
        client_id: SPA,
        response_type: 'code',
        redirect_uri: REDIRECT,
        scope: 'openid api://unregistered-resource/Do.Stuff',
        state: 'abc',
        code_challenge: s256('v'),
        code_challenge_method: 'S256',
      }),
    });
    expect(res.statusCode).toBe(302);
    const url = new URL(res.headers.location as string);
    expect(url.searchParams.get('error')).toBe('invalid_scope');
    expect(url.searchParams.get('state')).toBe('abc');
  });

  it('public client without code_challenge redirects back with invalid_request', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'GET',
      url: authorizeUrl({
        client_id: SPA,
        response_type: 'code',
        redirect_uri: REDIRECT,
        scope: 'openid',
        state: 'pkce',
      }),
    });
    expect(res.statusCode).toBe(302);
    const url = new URL(res.headers.location as string);
    expect(url.searchParams.get('error')).toBe('invalid_request');
  });
});

// ---------------------------------------------------------------------------
// Criterion 2 — account picker lists enabled users, issues a code, echoes state
// ---------------------------------------------------------------------------
describe('account picker (criterion 2)', () => {
  it('renders the picker listing seeded enabled users when there is no session', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'GET',
      url: authorizeUrl({
        client_id: SPA,
        response_type: 'code',
        redirect_uri: REDIRECT,
        scope: `openid ${SPA_SCOPE}`,
        code_challenge: s256('verifier'),
        code_challenge_method: 'S256',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('alice@entralocal.dev');
    expect(res.body).toContain('bob@entralocal.dev');
    expect(res.body).toContain('Local Emulator');
  });

  it('selecting a user issues a code and 302s to redirect_uri with the echoed state', async () => {
    ctx = await buildTestApp();
    const result = await signInAndGetCode(ctx, {
      state: 'state-123',
      codeChallenge: s256('verifier'),
    });
    expect(result.location.startsWith(REDIRECT)).toBe(true);
    expect(result.code).toMatch(/.+/);
    expect(result.state).toBe('state-123');
    expect(result.cookie).toContain('el_session=');
  });

  it('supports response_mode=fragment (code returned in the URL fragment)', async () => {
    ctx = await buildTestApp();
    const params: Record<string, string> = {
      client_id: SPA,
      response_type: 'code',
      redirect_uri: REDIRECT,
      scope: `openid ${SPA_SCOPE}`,
      response_mode: 'fragment',
      state: 'frag',
      code_challenge: s256('verifier'),
      code_challenge_method: 'S256',
    };
    const page = await ctx.inject({ method: 'GET', url: authorizeUrl(params) });
    const signedState = extractSignedState(page.body);
    const submit = await ctx.inject({
      method: 'POST',
      url: AUTHORIZE_PATH,
      headers: FORM_HEADERS,
      payload: form({ __el_state: signedState, __el_user: SEED.userAliceId }),
    });
    expect(submit.statusCode).toBe(302);
    const url = new URL(submit.headers.location as string);
    expect(url.hash).toContain('code=');
    expect(url.hash).toContain('state=frag');
    expect(url.search).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Criterion 3 — SSO session reuse + prompt variants + login_required
// ---------------------------------------------------------------------------
describe('SSO session + prompt handling (criterion 3)', () => {
  it('a second authorize with the session cookie and no prompt issues a code without the picker', async () => {
    ctx = await buildTestApp();
    const first = await signInAndGetCode(ctx, { codeChallenge: s256('v') });
    const res = await ctx.inject({
      method: 'GET',
      url: authorizeUrl({
        client_id: SPA,
        response_type: 'code',
        redirect_uri: REDIRECT,
        scope: `openid ${SPA_SCOPE}`,
        code_challenge: s256('v2'),
        code_challenge_method: 'S256',
      }),
      headers: { cookie: first.cookie },
    });
    expect(res.statusCode).toBe(302);
    expect(new URL(res.headers.location as string).searchParams.get('code')).toMatch(/.+/);
  });

  it('prompt=select_account forces the picker even with a valid session', async () => {
    ctx = await buildTestApp();
    const first = await signInAndGetCode(ctx, { codeChallenge: s256('v') });
    const res = await ctx.inject({
      method: 'GET',
      url: authorizeUrl({
        client_id: SPA,
        response_type: 'code',
        redirect_uri: REDIRECT,
        scope: `openid ${SPA_SCOPE}`,
        prompt: 'select_account',
        code_challenge: s256('v2'),
        code_challenge_method: 'S256',
      }),
      headers: { cookie: first.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('prompt=none without a session redirects back with error=login_required', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'GET',
      url: authorizeUrl({
        client_id: SPA,
        response_type: 'code',
        redirect_uri: REDIRECT,
        scope: `openid ${SPA_SCOPE}`,
        prompt: 'none',
        state: 's',
        code_challenge: s256('v'),
        code_challenge_method: 'S256',
      }),
    });
    expect(res.statusCode).toBe(302);
    const url = new URL(res.headers.location as string);
    expect(url.searchParams.get('error')).toBe('login_required');
    expect(url.searchParams.get('state')).toBe('s');
  });

  it('prompt=none WITH a valid session issues a code directly', async () => {
    ctx = await buildTestApp();
    const first = await signInAndGetCode(ctx, { codeChallenge: s256('v') });
    const res = await ctx.inject({
      method: 'GET',
      url: authorizeUrl({
        client_id: SPA,
        response_type: 'code',
        redirect_uri: REDIRECT,
        scope: `openid ${SPA_SCOPE}`,
        prompt: 'none',
        code_challenge: s256('v2'),
        code_challenge_method: 'S256',
      }),
      headers: { cookie: first.cookie },
    });
    expect(res.statusCode).toBe(302);
    expect(new URL(res.headers.location as string).searchParams.get('code')).toMatch(/.+/);
  });
});

// ---------------------------------------------------------------------------
// Criteria 4 & 5 — PKCE S256 / plain full exchange; wrong verifier fails
// ---------------------------------------------------------------------------
describe('PKCE code exchange (criteria 4, 5)', () => {
  it('S256: full code→token exchange with the correct verifier succeeds', async () => {
    ctx = await buildTestApp();
    const verifier = randomBytes(32).toString('base64url');
    const result = await signInAndGetCode(ctx, { codeChallenge: s256(verifier) });
    const token = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({
        grant_type: 'authorization_code',
        code: result.code,
        redirect_uri: REDIRECT,
        client_id: SPA,
        code_verifier: verifier,
      }),
    });
    expect(token.statusCode).toBe(200);
    const body = token.json() as { access_token: string; id_token: string };
    expect(body.access_token).toMatch(/.+/);
    expect(body.id_token).toMatch(/.+/);
  });

  it('S256: a wrong verifier fails with invalid_grant', async () => {
    ctx = await buildTestApp();
    const result = await signInAndGetCode(ctx, { codeChallenge: s256('the-right-verifier') });
    const token = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({
        grant_type: 'authorization_code',
        code: result.code,
        redirect_uri: REDIRECT,
        client_id: SPA,
        code_verifier: 'the-WRONG-verifier',
      }),
    });
    expect(token.statusCode).toBe(400);
    expect((token.json() as { error: string }).error).toBe('invalid_grant');
  });

  it('plain: full exchange with method=plain succeeds with the matching verifier', async () => {
    ctx = await buildTestApp();
    const verifier = 'plain-verifier-value-1234567890';
    const result = await signInAndGetCode(ctx, {
      codeChallenge: verifier,
      codeChallengeMethod: 'plain',
    });
    const token = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({
        grant_type: 'authorization_code',
        code: result.code,
        redirect_uri: REDIRECT,
        client_id: SPA,
        code_verifier: verifier,
      }),
    });
    expect(token.statusCode).toBe(200);
    expect((token.json() as { access_token: string }).access_token).toMatch(/.+/);
  });
});

// ---------------------------------------------------------------------------
// Criterion 6 — single-use code (replay → invalid_grant)
// ---------------------------------------------------------------------------
describe('single-use code (criterion 6)', () => {
  it('redeeming the same code twice fails on the second attempt with invalid_grant', async () => {
    ctx = await buildTestApp();
    const verifier = randomBytes(32).toString('base64url');
    const result = await signInAndGetCode(ctx, { codeChallenge: s256(verifier) });
    const payload = form({
      grant_type: 'authorization_code',
      code: result.code,
      redirect_uri: REDIRECT,
      client_id: SPA,
      code_verifier: verifier,
    });
    const first = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload,
    });
    expect(first.statusCode).toBe(200);
    const second = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload,
    });
    expect(second.statusCode).toBe(400);
    expect((second.json() as { error: string }).error).toBe('invalid_grant');
  });
});

// ---------------------------------------------------------------------------
// Criterion 7 — confidential client auth (post + basic; wrong/missing; public + secret)
// ---------------------------------------------------------------------------
describe('client authentication (criterion 7)', () => {
  const DAEMON = SEED.appDaemonId;
  const DAEMON_REDIRECT = 'https://localhost:5000/cb';

  /** Issue a code for the confidential daemon app directly via the token service. */
  function issueDaemonCode(app: TestApp): string {
    app.app.store.apps.addRedirectUri(DAEMON, DAEMON_REDIRECT, 'web');
    return app.app.tokenService.issueAuthCode({
      appId: DAEMON,
      userId: SEED.userAliceId,
      redirectUri: DAEMON_REDIRECT,
      scopes: ['openid', 'profile'],
      resource: null,
      codeChallenge: null,
      codeChallengeMethod: null,
      nonce: null,
    });
  }

  it('accepts client_secret_post for a confidential client', async () => {
    ctx = await buildTestApp();
    const code = issueDaemonCode(ctx);
    const token = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({
        grant_type: 'authorization_code',
        code,
        redirect_uri: DAEMON_REDIRECT,
        client_id: DAEMON,
        client_secret: SEED.daemonSecret,
      }),
    });
    expect(token.statusCode).toBe(200);
    expect((token.json() as { access_token: string }).access_token).toMatch(/.+/);
  });

  it('accepts client_secret_basic (Authorization: Basic) for a confidential client', async () => {
    ctx = await buildTestApp();
    const code = issueDaemonCode(ctx);
    const basic = Buffer.from(`${DAEMON}:${SEED.daemonSecret}`, 'utf8').toString('base64');
    const token = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: { ...FORM_HEADERS, authorization: `Basic ${basic}` },
      payload: form({
        grant_type: 'authorization_code',
        code,
        redirect_uri: DAEMON_REDIRECT,
        client_id: DAEMON,
      }),
    });
    expect(token.statusCode).toBe(200);
  });

  it('rejects a wrong client_secret with invalid_client (401)', async () => {
    ctx = await buildTestApp();
    const code = issueDaemonCode(ctx);
    const token = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({
        grant_type: 'authorization_code',
        code,
        redirect_uri: DAEMON_REDIRECT,
        client_id: DAEMON,
        client_secret: 'wrong-secret',
      }),
    });
    expect(token.statusCode).toBe(401);
    expect((token.json() as { error: string }).error).toBe('invalid_client');
  });

  it('rejects a missing client_secret for a confidential client with invalid_client', async () => {
    ctx = await buildTestApp();
    const code = issueDaemonCode(ctx);
    const token = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({
        grant_type: 'authorization_code',
        code,
        redirect_uri: DAEMON_REDIRECT,
        client_id: DAEMON,
      }),
    });
    expect(token.statusCode).toBe(401);
    expect((token.json() as { error: string }).error).toBe('invalid_client');
  });

  it('rejects a public client that presents a client_secret with invalid_client', async () => {
    ctx = await buildTestApp();
    const verifier = randomBytes(32).toString('base64url');
    const result = await signInAndGetCode(ctx, { codeChallenge: s256(verifier) });
    const token = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({
        grant_type: 'authorization_code',
        code: result.code,
        redirect_uri: REDIRECT,
        client_id: SPA,
        code_verifier: verifier,
        client_secret: 'should-not-be-here',
      }),
    });
    expect(token.statusCode).toBe(401);
    expect((token.json() as { error: string }).error).toBe('invalid_client');
  });

  it('rejects an unknown client_id with invalid_client', async () => {
    ctx = await buildTestApp();
    const token = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({
        grant_type: 'authorization_code',
        code: 'whatever',
        redirect_uri: REDIRECT,
        client_id: 'cccccccc-0000-0000-0000-00000000beef',
      }),
    });
    expect(token.statusCode).toBe(401);
    expect((token.json() as { error: string }).error).toBe('invalid_client');
  });
});

// ---------------------------------------------------------------------------
// Criterion 8 — token shape + offline_access; JWKS verification of nonce/aud/scp
// ---------------------------------------------------------------------------
describe('token shape + JWKS verification (criterion 8)', () => {
  async function jwks(app: TestApp): Promise<ReturnType<typeof createLocalJWKSet>> {
    const res = await app.inject({ method: 'GET', url: `/${T}/discovery/v2.0/keys` });
    return createLocalJWKSet(JSON.parse(res.body) as JSONWebKeySet);
  }

  it('returns access + id + refresh tokens with client_info when offline_access is granted', async () => {
    ctx = await buildTestApp();
    const verifier = randomBytes(32).toString('base64url');
    const result = await signInAndGetCode(ctx, {
      scope: `openid profile offline_access ${SPA_SCOPE}`,
      nonce: 'nonce-xyz',
      codeChallenge: s256(verifier),
    });
    const token = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({
        grant_type: 'authorization_code',
        code: result.code,
        redirect_uri: REDIRECT,
        client_id: SPA,
        code_verifier: verifier,
      }),
    });
    expect(token.statusCode).toBe(200);
    expect(token.headers['cache-control']).toContain('no-store');
    expect(token.headers['pragma']).toContain('no-cache');
    const body = token.json() as {
      token_type: string;
      access_token: string;
      id_token: string;
      refresh_token?: string;
      client_info?: string;
      scope: string;
    };
    expect(body.token_type).toBe('Bearer');
    expect(body.refresh_token).toMatch(/.+/);
    expect(body.client_info).toMatch(/.+/);

    const set = await jwks(ctx);
    const access = await jwtVerify(body.access_token, set);
    expect(access.payload.aud).toBe(SPA); // api:// resource scope → resource app's appId
    expect(access.payload.scp).toContain(SEED.spaScopeValue);

    const id = await jwtVerify(body.id_token, set);
    expect(id.payload.aud).toBe(SPA);
    expect(id.payload.nonce).toBe('nonce-xyz');
  });

  it('omits refresh_token when offline_access is NOT granted', async () => {
    ctx = await buildTestApp();
    const verifier = randomBytes(32).toString('base64url');
    const result = await signInAndGetCode(ctx, {
      scope: `openid ${SPA_SCOPE}`,
      codeChallenge: s256(verifier),
    });
    const token = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({
        grant_type: 'authorization_code',
        code: result.code,
        redirect_uri: REDIRECT,
        client_id: SPA,
        code_verifier: verifier,
      }),
    });
    expect(token.statusCode).toBe(200);
    const body = token.json() as { refresh_token?: string };
    expect(body.refresh_token).toBeUndefined();
  });

  it('rejects a redirect_uri that differs from the authorize request with invalid_grant', async () => {
    ctx = await buildTestApp();
    const verifier = randomBytes(32).toString('base64url');
    const result = await signInAndGetCode(ctx, { codeChallenge: s256(verifier) });
    const token = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({
        grant_type: 'authorization_code',
        code: result.code,
        redirect_uri: 'https://localhost:3000/other',
        client_id: SPA,
        code_verifier: verifier,
      }),
    });
    // The mismatched redirect is not even registered, but redemption also enforces the binding.
    expect(token.statusCode).toBe(400);
    expect((token.json() as { error: string }).error).toBe('invalid_grant');
  });
});

// ---------------------------------------------------------------------------
// Criterion 9 — canonical error convention (each row: error + status + no-store)
// ---------------------------------------------------------------------------
describe('canonical OAuth error convention (criterion 9)', () => {
  /** Assert the AADSTS-style shape + no-store on a token-endpoint error body. */
  function assertAadstsShape(res: { headers: Record<string, unknown>; body: string }): void {
    expect(res.headers['cache-control']).toContain('no-store');
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
    expect(typeof body.error_description).toBe('string');
    expect(Array.isArray(body.error_codes)).toBe(true);
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.trace_id).toBe('string');
    expect(typeof body.correlation_id).toBe('string');
  }

  it('unknown grant_type → unsupported_grant_type (400, no-store)', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({ grant_type: 'made_up_grant' }),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('unsupported_grant_type');
    assertAadstsShape(res);
  });

  it('missing grant_type → invalid_request (400, no-store)', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({ code: 'x' }),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_request');
    assertAadstsShape(res);
  });

  it('missing required param (code) → invalid_request (400, no-store)', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({ grant_type: 'authorization_code', client_id: SPA, redirect_uri: REDIRECT }),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_request');
    assertAadstsShape(res);
  });

  it('bad code → invalid_grant (400, no-store)', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({
        grant_type: 'authorization_code',
        code: 'not-a-real-code',
        redirect_uri: REDIRECT,
        client_id: SPA,
        code_verifier: 'v',
      }),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_grant');
    assertAadstsShape(res);
  });

  it('bad client secret → invalid_client (401, no-store)', async () => {
    ctx = await buildTestApp();
    ctx.app.store.apps.addRedirectUri(SEED.appDaemonId, 'https://localhost:5000/cb', 'web');
    const code = ctx.app.tokenService.issueAuthCode({
      appId: SEED.appDaemonId,
      userId: SEED.userAliceId,
      redirectUri: 'https://localhost:5000/cb',
      scopes: ['openid'],
      resource: null,
      codeChallenge: null,
      codeChallengeMethod: null,
      nonce: null,
    });
    const res = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://localhost:5000/cb',
        client_id: SEED.appDaemonId,
        client_secret: 'nope',
      }),
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe('invalid_client');
    assertAadstsShape(res);
  });

  it('requested scope exceeds grant → invalid_scope (400, no-store)', async () => {
    ctx = await buildTestApp();
    const verifier = randomBytes(32).toString('base64url');
    const result = await signInAndGetCode(ctx, {
      scope: `openid ${SPA_SCOPE}`,
      codeChallenge: s256(verifier),
    });
    const res = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({
        grant_type: 'authorization_code',
        code: result.code,
        redirect_uri: REDIRECT,
        client_id: SPA,
        code_verifier: verifier,
        scope: 'openid Files.ReadWrite.All',
      }),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_scope');
    assertAadstsShape(res);
  });

  it('unsupported tenant alias on the token endpoint → invalid_request (400, no-store)', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'POST',
      url: '/badtenant/oauth2/v2.0/token',
      headers: FORM_HEADERS,
      payload: form({ grant_type: 'authorization_code' }),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_request');
    expect(res.headers['cache-control']).toContain('no-store');
  });
});

// ---------------------------------------------------------------------------
// Criterion 11 — REQUIRE_PASSWORD replaces the picker
// ---------------------------------------------------------------------------
describe('REQUIRE_PASSWORD password form (criterion 11)', () => {
  it('renders a password form (not the account picker) when REQUIRE_PASSWORD=true', async () => {
    ctx = await buildTestApp({ requirePassword: true });
    const res = await ctx.inject({
      method: 'GET',
      url: authorizeUrl({
        client_id: SPA,
        response_type: 'code',
        redirect_uri: REDIRECT,
        scope: `openid ${SPA_SCOPE}`,
        code_challenge: s256('v'),
        code_challenge_method: 'S256',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('__el_password');
    expect(res.body).toContain('__el_username');
    // The picker's per-account submit field is absent in password mode.
    expect(res.body).not.toContain('name="__el_user"');
  });

  it('correct seeded password completes the flow and issues a code', async () => {
    ctx = await buildTestApp({ requirePassword: true });
    const page = await ctx.inject({
      method: 'GET',
      url: authorizeUrl({
        client_id: SPA,
        response_type: 'code',
        redirect_uri: REDIRECT,
        scope: `openid ${SPA_SCOPE}`,
        state: 'pw',
        code_challenge: s256('v'),
        code_challenge_method: 'S256',
      }),
    });
    const signedState = extractSignedState(page.body);
    const res = await ctx.inject({
      method: 'POST',
      url: AUTHORIZE_PATH,
      headers: FORM_HEADERS,
      payload: form({
        __el_state: signedState,
        __el_username: 'alice@entralocal.dev',
        __el_password: SEED.userPassword,
      }),
    });
    expect(res.statusCode).toBe(302);
    const url = new URL(res.headers.location as string);
    expect(url.searchParams.get('code')).toMatch(/.+/);
    expect(url.searchParams.get('state')).toBe('pw');
  });

  it('wrong password re-renders the form with an error and issues NO code', async () => {
    ctx = await buildTestApp({ requirePassword: true });
    const page = await ctx.inject({
      method: 'GET',
      url: authorizeUrl({
        client_id: SPA,
        response_type: 'code',
        redirect_uri: REDIRECT,
        scope: `openid ${SPA_SCOPE}`,
        code_challenge: s256('v'),
        code_challenge_method: 'S256',
      }),
    });
    const signedState = extractSignedState(page.body);
    const res = await ctx.inject({
      method: 'POST',
      url: AUTHORIZE_PATH,
      headers: FORM_HEADERS,
      payload: form({
        __el_state: signedState,
        __el_username: 'alice@entralocal.dev',
        __el_password: 'wrong-password',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toContain('incorrect');
  });
});

// ---------------------------------------------------------------------------
// Tamper protection — forged signed state is rejected (no redirect)
// ---------------------------------------------------------------------------
describe('signed-state integrity', () => {
  it('rejects a tampered __el_state with a 400 error page (no redirect)', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'POST',
      url: AUTHORIZE_PATH,
      headers: FORM_HEADERS,
      payload: form({ __el_state: 'forged.payload', __el_user: SEED.userAliceId }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers.location).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #11 regression — an app created via the Admin REST API is immediately usable
// in the Authorization Code flow (global-spec §15 criterion 6 / #11 criterion 9).
// ---------------------------------------------------------------------------
describe('admin-created app signs in (#11 criterion 9)', () => {
  it('a public app registered via /admin/api drives authorize→token end to end', async () => {
    ctx = await buildTestApp();
    const JSON_HEADERS = { 'content-type': 'application/json' };
    const newRedirect = 'https://localhost:7100/auth';

    // 1. Create a brand-new public app (+ redirect URI) through the Admin REST API.
    const created = await ctx.inject({
      method: 'POST',
      url: '/admin/api/apps',
      headers: JSON_HEADERS,
      payload: {
        displayName: 'Admin-created SPA',
        isConfidential: false,
        redirectUris: [{ uri: newRedirect, type: 'spa' }],
      },
    });
    expect(created.statusCode).toBe(201);
    const newAppId = (created.json() as { id: string; isConfidential: boolean }).id;

    // 2. Drive the interactive sign-in against the NEW app.
    const verifier = randomBytes(32).toString('base64url');
    const params: Record<string, string> = {
      client_id: newAppId,
      response_type: 'code',
      redirect_uri: newRedirect,
      scope: 'openid profile offline_access',
      code_challenge: s256(verifier),
      code_challenge_method: 'S256',
    };
    const page = await ctx.inject({ method: 'GET', url: authorizeUrl(params) });
    expect(page.statusCode).toBe(200);
    const signedState = extractSignedState(page.body);

    const submit = await ctx.inject({
      method: 'POST',
      url: AUTHORIZE_PATH,
      headers: FORM_HEADERS,
      payload: form({ __el_state: signedState, __el_user: SEED.userAliceId }),
    });
    expect(submit.statusCode).toBe(302);
    const code = new URL(submit.headers.location as string).searchParams.get('code') ?? '';
    expect(code).toMatch(/.+/);

    // 3. Redeem the code for tokens — proving the admin → working-app path.
    const token = await ctx.inject({
      method: 'POST',
      url: TOKEN_PATH,
      headers: FORM_HEADERS,
      payload: form({
        grant_type: 'authorization_code',
        code,
        redirect_uri: newRedirect,
        client_id: newAppId,
        code_verifier: verifier,
      }),
    });
    expect(token.statusCode).toBe(200);
    const body = token.json() as { access_token: string; id_token: string };
    expect(body.access_token).toMatch(/.+/);
    expect(body.id_token).toMatch(/.+/);
  });
});
