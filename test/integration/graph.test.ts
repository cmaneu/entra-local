import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { decodeJwt } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { SEED } from '../../src/store/seed.js';
import type { AccessTokenClaims } from '../../src/tokens/claims.js';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';

/**
 * Integration tests for feature #10 — Minimal Microsoft Graph (`/graph/v1.0/*`). Drives the full
 * mint→consume loop in-process via `app.inject`: sign-in + code→token (#6) mints a Graph-audience
 * access token, then Graph consumes it. Covers acceptance criteria 1–10. The real-MSAL `/me` browser
 * flow lives in the e2e suite.
 */

const T = TEST_TENANT_ID;
const AUTHORIZE_PATH = `/${T}/oauth2/v2.0/authorize`;
const TOKEN_PATH = `/${T}/oauth2/v2.0/token`;
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

/** Drive the interactive sign-in + code→token exchange and return the issued access token. */
async function delegatedToken(app: TestApp, opts: { scope?: string } = {}): Promise<string> {
  const verifier = randomBytes(32).toString('base64url');
  const params: Record<string, string> = {
    client_id: SPA,
    response_type: 'code',
    redirect_uri: REDIRECT,
    scope: opts.scope ?? `openid profile offline_access ${GRAPH}/User.Read`,
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
  return (token.json() as { access_token: string }).access_token;
}

/** Mint an app-only (client-credentials) Graph-audience token via the daemon app (no `oid`). */
async function appOnlyToken(app: TestApp): Promise<string> {
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

function graphGet(app: TestApp, url: string, bearer?: string) {
  return app.inject({
    method: 'GET',
    url,
    headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
  });
}

// ---------------------------------------------------------------------------
// Criterion 1 — /me happy path
// ---------------------------------------------------------------------------
describe('Graph /me happy path (criterion 1)', () => {
  it('returns the signed-in user with @odata.context, id == oid, and Graph-cased fields', async () => {
    ctx = await buildTestApp();
    const token = await delegatedToken(ctx);
    const oid = decodeJwt(token).oid as string;

    const res = await graphGet(ctx, '/graph/v1.0/me', token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const body = res.json() as Record<string, unknown>;
    expect(body['@odata.context']).toBe(
      `${ctx.config.publicOrigin}/graph/v1.0/$metadata#users/$entity`,
    );
    expect(body.id).toBe(oid);
    expect(body.id).toBe(SEED.userAliceId);
    expect(body.displayName).toBe('Alice Example');
    expect(body.userPrincipalName).toBe('alice@entralocal.dev');
    expect(body.mail).toBe('alice@entralocal.dev');
    expect(body.givenName).toBe('Alice');
    expect(body.surname).toBe('Example');
    expect(body.accountEnabled).toBe(true);
  });

  it('404 Request_ResourceNotFound when the signed-in user no longer exists', async () => {
    ctx = await buildTestApp();
    // A delegated token whose `oid` points at a user that is not in the directory.
    const now = Math.floor(Date.now() / 1000);
    const claims: AccessTokenClaims = {
      iss: ctx.config.issuer,
      sub: 'ghost-sub',
      aud: ctx.config.graphResourceId,
      exp: now + 3600,
      iat: now,
      nbf: now,
      tid: T,
      azp: SPA,
      appid: SPA,
      oid: 'aaaaaaaa-0000-0000-0000-00000000dead',
      scp: 'User.Read',
      ver: '2.0',
    };
    const token = await ctx.app.tokenService.mintAccessToken(T, claims);
    const res = await graphGet(ctx, '/graph/v1.0/me', token);
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('Request_ResourceNotFound');
  });
});

// ---------------------------------------------------------------------------
// Criterion 2 — mint→consume loop (accepted; tampered → 401)
// ---------------------------------------------------------------------------
describe('Graph mint→consume loop (criterion 2)', () => {
  it('accepts a token minted by #5/#6 and rejects a tampered signature with 401', async () => {
    ctx = await buildTestApp();
    const token = await delegatedToken(ctx);
    expect((await graphGet(ctx, '/graph/v1.0/me', token)).statusCode).toBe(200);

    const parts = token.split('.');
    const sig = parts[2]!;
    parts[2] = (sig.startsWith('A') ? 'B' : 'A') + sig.slice(1);
    const tampered = await graphGet(ctx, '/graph/v1.0/me', parts.join('.'));
    expect(tampered.statusCode).toBe(401);
    expect(String(tampered.headers['www-authenticate'])).toContain('Bearer error="invalid_token"');
    expect((tampered.json() as { error: { code: string } }).error.code).toBe(
      'InvalidAuthenticationToken',
    );
  });

  it('rejects a token signed by a different (unknown) key with 401', async () => {
    ctx = await buildTestApp();
    // A second app with a freshly-generated (non-seeded) signing key → a different, unknown kid.
    const other = await buildTestApp(undefined, { seedSigningKey: false });
    const foreignToken = await delegatedToken(other);
    await other.close();
    const res = await graphGet(ctx, '/graph/v1.0/me', foreignToken);
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'InvalidAuthenticationToken',
    );
  });
});

// ---------------------------------------------------------------------------
// Criterion 3 — audience / issuer enforcement
// ---------------------------------------------------------------------------
describe('Graph audience/issuer enforcement (criterion 3)', () => {
  it('a non-Graph audience (resource api:// token) → 401', async () => {
    ctx = await buildTestApp();
    const token = await delegatedToken(ctx, {
      scope: `openid profile offline_access ${SPA_SCOPE}`,
    });
    expect(decodeJwt(token).aud).toBe(SPA);
    const res = await graphGet(ctx, '/graph/v1.0/me', token);
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'InvalidAuthenticationToken',
    );
  });

  it('a wrong issuer → 401', async () => {
    ctx = await buildTestApp();
    const now = Math.floor(Date.now() / 1000);
    const claims: AccessTokenClaims = {
      iss: 'https://evil.example/issuer',
      sub: 'sub',
      aud: ctx.config.graphResourceId,
      exp: now + 3600,
      iat: now,
      nbf: now,
      tid: T,
      azp: SPA,
      appid: SPA,
      oid: SEED.userAliceId,
      scp: 'User.Read',
      ver: '2.0',
    };
    const badIss = await ctx.app.tokenService.mintAccessToken(T, claims);
    const res = await graphGet(ctx, '/graph/v1.0/me', badIss);
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Criterion 4 — ver:"2.0" accepted
// ---------------------------------------------------------------------------
describe('Graph accepts ver:"2.0" tokens (criterion 4)', () => {
  it('the emulator v2 access token is accepted (not rejected for not being v1)', async () => {
    ctx = await buildTestApp();
    const token = await delegatedToken(ctx);
    expect(decodeJwt(token).ver).toBe('2.0');
    expect((await graphGet(ctx, '/graph/v1.0/me', token)).statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Criterion 5 — app-only token: 403 on /me, OK on /users + /groups
// ---------------------------------------------------------------------------
describe('Graph app-only authorization (criterion 5)', () => {
  it('app-only token → 403 on /me, but 200 on /users and /groups', async () => {
    ctx = await buildTestApp();
    const token = await appOnlyToken(ctx);
    expect(decodeJwt(token).oid).toBeUndefined();

    const me = await graphGet(ctx, '/graph/v1.0/me', token);
    expect(me.statusCode).toBe(403);
    expect((me.json() as { error: { code: string } }).error.code).toBe(
      'Authorization_RequestDenied',
    );

    expect((await graphGet(ctx, '/graph/v1.0/users', token)).statusCode).toBe(200);
    expect((await graphGet(ctx, '/graph/v1.0/groups', token)).statusCode).toBe(200);
  });

  it('an app-only token with an empty roles array is still accepted on /users', async () => {
    ctx = await buildTestApp();
    const now = Math.floor(Date.now() / 1000);
    const claims: AccessTokenClaims = {
      iss: ctx.config.issuer,
      sub: SEED.appDaemonId,
      aud: ctx.config.graphResourceId,
      exp: now + 3600,
      iat: now,
      nbf: now,
      tid: T,
      azp: SEED.appDaemonId,
      appid: SEED.appDaemonId,
      roles: [],
      ver: '2.0',
    };
    const token = await ctx.app.tokenService.mintAccessToken(T, claims);
    expect((await graphGet(ctx, '/graph/v1.0/users', token)).statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Criterion 6 — users collection + paging (preserves $top)
// ---------------------------------------------------------------------------
describe('Graph users collection + paging (criterion 6)', () => {
  it('returns a collection envelope and pages with $top, preserving $top in nextLink', async () => {
    ctx = await buildTestApp();
    const token = await delegatedToken(ctx);

    const all = await graphGet(ctx, '/graph/v1.0/users', token);
    expect(all.statusCode).toBe(200);
    const allBody = all.json() as { '@odata.context': string; value: unknown[] };
    expect(allBody['@odata.context']).toBe(`${ctx.config.publicOrigin}/graph/v1.0/$metadata#users`);
    expect(Array.isArray(allBody.value)).toBe(true);
    expect(allBody.value.length).toBeGreaterThanOrEqual(2);
    expect(allBody).not.toHaveProperty('@odata.nextLink');

    // First page of size 1 → nextLink present, preserves $top=1.
    const p1 = await graphGet(ctx, '/graph/v1.0/users?$top=1', token);
    const p1Body = p1.json() as {
      value: { id: string }[];
      '@odata.nextLink'?: string;
    };
    expect(p1Body.value).toHaveLength(1);
    const next = p1Body['@odata.nextLink'];
    expect(next).toBeDefined();
    expect(next).toContain('$top=1');
    const nextUrl = new URL(next!);
    expect(nextUrl.searchParams.get('$top')).toBe('1');
    expect(nextUrl.searchParams.get('$skiptoken')).toBe('1');

    // Follow it → exactly one next row.
    const p2 = await graphGet(ctx, nextUrl.pathname + nextUrl.search, token);
    const p2Body = p2.json() as { value: { id: string }[] };
    expect(p2Body.value).toHaveLength(1);
    expect(p2Body.value[0]!.id).not.toBe(p1Body.value[0]!.id);

    // Last page omits nextLink (2 seeded users → skiptoken=1 is the final page).
    expect(p2Body).not.toHaveProperty('@odata.nextLink');
  });
});

// ---------------------------------------------------------------------------
// Criterion 7 — user by id or UPN; unknown → 404
// ---------------------------------------------------------------------------
describe('Graph user by id or UPN (criterion 7)', () => {
  it('resolves Alice by GUID id and by UPN; unknown id → 404', async () => {
    ctx = await buildTestApp();
    const token = await delegatedToken(ctx);

    const byId = await graphGet(ctx, `/graph/v1.0/users/${SEED.userAliceId}`, token);
    expect(byId.statusCode).toBe(200);
    expect((byId.json() as { id: string }).id).toBe(SEED.userAliceId);

    const byUpn = await graphGet(ctx, '/graph/v1.0/users/alice@entralocal.dev', token);
    expect(byUpn.statusCode).toBe(200);
    expect((byUpn.json() as { userPrincipalName: string }).userPrincipalName).toBe(
      'alice@entralocal.dev',
    );

    const unknown = await graphGet(ctx, '/graph/v1.0/users/nope@nowhere.dev', token);
    expect(unknown.statusCode).toBe(404);
    expect((unknown.json() as { error: { code: string } }).error.code).toBe(
      'Request_ResourceNotFound',
    );
  });
});

// ---------------------------------------------------------------------------
// Criterion 8 — groups + members; unknown group → 404
// ---------------------------------------------------------------------------
describe('Graph groups + members (criterion 8)', () => {
  it('lists Engineering, returns Alice + Bob as members, 404 on unknown group', async () => {
    ctx = await buildTestApp();
    const token = await delegatedToken(ctx);

    const groups = await graphGet(ctx, '/graph/v1.0/groups', token);
    expect(groups.statusCode).toBe(200);
    const gBody = groups.json() as {
      '@odata.context': string;
      value: { id: string; displayName: string; mailEnabled: boolean; securityEnabled: boolean }[];
    };
    expect(gBody['@odata.context']).toBe(`${ctx.config.publicOrigin}/graph/v1.0/$metadata#groups`);
    const eng = gBody.value.find((g) => g.id === SEED.groupEngineeringId);
    expect(eng).toBeDefined();
    expect(eng!.displayName).toBe('Engineering');
    expect(eng!.mailEnabled).toBe(false);
    expect(eng!.securityEnabled).toBe(true);

    const single = await graphGet(ctx, `/graph/v1.0/groups/${SEED.groupEngineeringId}`, token);
    expect(single.statusCode).toBe(200);
    expect((single.json() as { '@odata.context': string })['@odata.context']).toBe(
      `${ctx.config.publicOrigin}/graph/v1.0/$metadata#groups/$entity`,
    );

    const members = await graphGet(
      ctx,
      `/graph/v1.0/groups/${SEED.groupEngineeringId}/members`,
      token,
    );
    expect(members.statusCode).toBe(200);
    const mBody = members.json() as { value: { id: string; userPrincipalName: string }[] };
    const ids = mBody.value.map((u) => u.id).sort();
    expect(ids).toEqual([SEED.userAliceId, SEED.userBobId].sort());

    const unknown = await graphGet(ctx, '/graph/v1.0/groups/does-not-exist', token);
    expect(unknown.statusCode).toBe(404);
    expect((unknown.json() as { error: { code: string } }).error.code).toBe(
      'Request_ResourceNotFound',
    );

    const unknownMembers = await graphGet(ctx, '/graph/v1.0/groups/does-not-exist/members', token);
    expect(unknownMembers.statusCode).toBe(404);
  });
});

describe('Graph memberOf (group overage resolution)', () => {
  it('Graph_MeMemberOf_ReturnsSignedInUserGroups and /users/{id}/memberOf resolves memberships', async () => {
    ctx = await buildTestApp();
    const token = await delegatedToken(ctx);

    const me = await graphGet(ctx, '/graph/v1.0/me/memberOf', token);
    expect(me.statusCode).toBe(200);
    const meBody = me.json() as {
      '@odata.context': string;
      value: { id: string; displayName: string }[];
    };
    // Alice is the seeded signed-in user; she belongs to Engineering + 3 token-config groups.
    const meIds = meBody.value.map((g) => g.id);
    expect(meIds).toEqual(
      expect.arrayContaining([
        SEED.groupEngineeringId,
        SEED.groupDevelopersId,
        SEED.groupDataTeamId,
        SEED.groupLocalAdminsId,
      ]),
    );

    const byId = await graphGet(ctx, `/graph/v1.0/users/${SEED.userBobId}/memberOf`, token);
    expect(byId.statusCode).toBe(200);
    const bobIds = (byId.json() as { value: { id: string }[] }).value.map((g) => g.id).sort();
    expect(bobIds).toEqual([SEED.groupEngineeringId, SEED.groupDevelopersId].sort());
  });
});

// ---------------------------------------------------------------------------
// Criterion 9 — missing token → 401 with WWW-Authenticate + Graph error body
// ---------------------------------------------------------------------------
describe('Graph missing token (criterion 9)', () => {
  it('every Graph endpoint without a Bearer → 401 + WWW-Authenticate + Graph error body', async () => {
    ctx = await buildTestApp();
    const urls = [
      '/graph/v1.0/me',
      '/graph/v1.0/users',
      `/graph/v1.0/users/${SEED.userAliceId}`,
      '/graph/v1.0/groups',
      `/graph/v1.0/groups/${SEED.groupEngineeringId}`,
      `/graph/v1.0/groups/${SEED.groupEngineeringId}/members`,
    ];
    for (const url of urls) {
      const res = await graphGet(ctx, url);
      expect(res.statusCode, url).toBe(401);
      expect(res.headers['content-type'], url).toContain('application/json');
      expect(String(res.headers['www-authenticate']), url).toContain(
        'Bearer error="invalid_token"',
      );
      const body = res.json() as { error: { code: string; message: string } };
      expect(body.error.code, url).toBe('InvalidAuthenticationToken');
      expect(body.error.message, url).toBeTruthy();
      // Never SPA HTML.
      expect(res.headers['content-type'], url).not.toContain('text/html');
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 10 — Graph shape (PUBLIC_ORIGIN context, value[], Graph-cased fields)
// ---------------------------------------------------------------------------
describe('Graph response shape (criterion 10)', () => {
  it('contexts derive from PUBLIC_ORIGIN; collection items omit per-entity context', async () => {
    ctx = await buildTestApp();
    const token = await delegatedToken(ctx);

    const users = await graphGet(ctx, '/graph/v1.0/users', token);
    const body = users.json() as {
      '@odata.context': string;
      value: Record<string, unknown>[];
    };
    expect(body['@odata.context'].startsWith(ctx.config.publicOrigin)).toBe(true);
    // Collection items expose Graph-cased fields and omit their own context.
    for (const item of body.value) {
      expect(item).not.toHaveProperty('@odata.context');
      expect(item).toHaveProperty('displayName');
      expect(item).toHaveProperty('userPrincipalName');
    }
  });
});
