import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { SEED } from '../../src/store/seed.js';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';

/**
 * Integration tests for feature #8 — Client Credentials flow (app-only tokens). Exercises the
 * `grant_type=client_credentials` branch of the `/token` endpoint in-process via `app.inject`,
 * covering acceptance criteria 1–7 (the real-MSAL e2e is criterion 8, in the e2e suite).
 */

const T = TEST_TENANT_ID;
const TOKEN_PATH = `/${T}/oauth2/v2.0/token`;
const KEYS_PATH = `/${T}/discovery/v2.0/keys`;
const DAEMON = SEED.appDaemonId;
const DAEMON_URI = `api://${DAEMON}`;
const DAEMON_DEFAULT = `${DAEMON_URI}/.default`;
const GRAPH = 'https://graph.microsoft.com';
const GRAPH_DEFAULT = `${GRAPH}/.default`;
const SPA = SEED.appSpaId; // public client (no secret)

const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded' };

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

/** Form-encode a record for an `application/x-www-form-urlencoded` body. */
function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

/** POST the client_credentials grant and return the raw inject response. */
async function token(
  app: TestApp,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) {
  return await app.inject({
    method: 'POST',
    url: TOKEN_PATH,
    headers: { ...FORM_HEADERS, ...headers },
    payload: form({ grant_type: 'client_credentials', ...fields }),
  });
}

async function jwks(app: TestApp): Promise<ReturnType<typeof createLocalJWKSet>> {
  const res = await app.inject({ method: 'GET', url: KEYS_PATH });
  return createLocalJWKSet(JSON.parse(res.body) as JSONWebKeySet);
}

interface CcBody {
  token_type?: string;
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  client_info?: string;
  expires_in?: number;
  ext_expires_in?: number;
  scope?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Criterion 1 — happy path (app-only token; no id/refresh/client_info; no-store)
// ---------------------------------------------------------------------------
describe('happy path (criterion 1)', () => {
  it('returns an app-only access token with no id/refresh/client_info and no-store', async () => {
    ctx = await buildTestApp();
    const res = await token(ctx, {
      client_id: DAEMON,
      client_secret: SEED.daemonSecret,
      scope: DAEMON_DEFAULT,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['pragma']).toContain('no-cache');
    const body = res.json() as CcBody;
    expect(body.token_type).toBe('Bearer');
    expect(body.access_token).toMatch(/.+/);
    expect(body.scope).toBe(DAEMON_DEFAULT); // echoes the requested .default
    expect(body.id_token).toBeUndefined();
    expect(body.refresh_token).toBeUndefined();
    expect(body.client_info).toBeUndefined();
    expect(body.expires_in).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Criterion 2 — app-only claims (JWKS verify; sub/appid/azp/roles/ver; no oid/scp)
// ---------------------------------------------------------------------------
describe('app-only claims (criterion 2)', () => {
  it('mints sub=appid=azp=appId, roles array, ver=2.0, no oid/scp; verifies against JWKS', async () => {
    ctx = await buildTestApp();
    const res = await token(ctx, {
      client_id: DAEMON,
      client_secret: SEED.daemonSecret,
      scope: DAEMON_DEFAULT,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as CcBody;
    const set = await jwks(ctx);
    const { payload } = await jwtVerify(body.access_token as string, set);
    expect(payload.iss).toBe(ctx.config.issuer);
    expect(payload.sub).toBe(DAEMON);
    expect(payload.appid).toBe(DAEMON);
    expect(payload.azp).toBe(DAEMON);
    expect(payload.aud).toBe(DAEMON_URI);
    expect(Array.isArray(payload.roles)).toBe(true);
    expect(payload.ver).toBe('2.0');
    expect(payload.tid).toBe(T);
    expect(payload.oid).toBeUndefined();
    expect(payload.scp).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Criterion 3 — role auto-grant (own app_id_uri → Tasks.Read.All; Graph → [])
// ---------------------------------------------------------------------------
describe('role auto-grant (criterion 3)', () => {
  it('grants the resource app Application-type enabled roles for its own .default', async () => {
    ctx = await buildTestApp();
    const res = await token(ctx, {
      client_id: DAEMON,
      client_secret: SEED.daemonSecret,
      scope: DAEMON_DEFAULT,
    });
    const body = res.json() as CcBody;
    const set = await jwks(ctx);
    const { payload } = await jwtVerify(body.access_token as string, set);
    expect(payload.roles).toContain(SEED.daemonRoleValue); // Tasks.Read.All
  });

  it('returns roles=[] for the Graph resource (no registered resource app)', async () => {
    ctx = await buildTestApp();
    const res = await token(ctx, {
      client_id: DAEMON,
      client_secret: SEED.daemonSecret,
      scope: GRAPH_DEFAULT,
    });
    const body = res.json() as CcBody;
    const set = await jwks(ctx);
    const { payload } = await jwtVerify(body.access_token as string, set);
    expect(payload.aud).toBe(GRAPH);
    expect(payload.roles).toEqual([]);
  });

  it('excludes disabled and non-Application roles from the grant', async () => {
    ctx = await buildTestApp();
    // Add a disabled Application role and an enabled User-only role: neither must appear.
    ctx.app.store.apps.addRole(DAEMON, {
      value: 'Disabled.Role',
      allowedMemberTypes: 'Application',
      isEnabled: false,
    });
    ctx.app.store.apps.addRole(DAEMON, {
      value: 'User.Only',
      allowedMemberTypes: 'User',
      isEnabled: true,
    });
    const res = await token(ctx, {
      client_id: DAEMON,
      client_secret: SEED.daemonSecret,
      scope: DAEMON_DEFAULT,
    });
    const body = res.json() as CcBody;
    const set = await jwks(ctx);
    const { payload } = await jwtVerify(body.access_token as string, set);
    const roles = payload.roles as string[];
    expect(roles).toContain(SEED.daemonRoleValue);
    expect(roles).not.toContain('Disabled.Role');
    expect(roles).not.toContain('User.Only');
  });
});

// ---------------------------------------------------------------------------
// Criterion 4 — client auth (post + basic; wrong secret; public app)
// ---------------------------------------------------------------------------
describe('client auth (criterion 4)', () => {
  it('accepts client_secret_post', async () => {
    ctx = await buildTestApp();
    const res = await token(ctx, {
      client_id: DAEMON,
      client_secret: SEED.daemonSecret,
      scope: DAEMON_DEFAULT,
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts client_secret_basic', async () => {
    ctx = await buildTestApp();
    const basic = Buffer.from(`${DAEMON}:${SEED.daemonSecret}`, 'utf8').toString('base64');
    const res = await token(ctx, { scope: DAEMON_DEFAULT }, { authorization: `Basic ${basic}` });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a wrong client_secret with invalid_client (401)', async () => {
    ctx = await buildTestApp();
    const res = await token(ctx, {
      client_id: DAEMON,
      client_secret: 'wrong',
      scope: DAEMON_DEFAULT,
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as CcBody).error).toBe('invalid_client');
  });

  it('rejects a public (SPA) client attempting client_credentials with invalid_client', async () => {
    ctx = await buildTestApp();
    const res = await token(ctx, { client_id: SPA, scope: `api://${SPA}/.default` });
    expect(res.statusCode).toBe(401);
    expect((res.json() as CcBody).error).toBe('invalid_client');
  });

  it('rejects a public client even if it presents a secret', async () => {
    ctx = await buildTestApp();
    const res = await token(ctx, {
      client_id: SPA,
      client_secret: 'whatever',
      scope: `api://${SPA}/.default`,
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as CcBody).error).toBe('invalid_client');
  });

  it('rejects an unknown client_id with invalid_client', async () => {
    ctx = await buildTestApp();
    const res = await token(ctx, {
      client_id: 'cccccccc-0000-0000-0000-00000000dead',
      client_secret: 'x',
      scope: GRAPH_DEFAULT,
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as CcBody).error).toBe('invalid_client');
  });
});

// ---------------------------------------------------------------------------
// Criterion 5 — scope validation
// ---------------------------------------------------------------------------
describe('scope validation (criterion 5)', () => {
  it('rejects a missing scope with invalid_request', async () => {
    ctx = await buildTestApp();
    const res = await token(ctx, { client_id: DAEMON, client_secret: SEED.daemonSecret });
    expect(res.statusCode).toBe(400);
    expect((res.json() as CcBody).error).toBe('invalid_request');
  });

  it('rejects a non-.default scope with invalid_scope', async () => {
    ctx = await buildTestApp();
    const res = await token(ctx, {
      client_id: DAEMON,
      client_secret: SEED.daemonSecret,
      scope: `${DAEMON_URI}/access_as_user`,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as CcBody).error).toBe('invalid_scope');
  });

  it('rejects an unresolvable resource with invalid_scope', async () => {
    ctx = await buildTestApp();
    const res = await token(ctx, {
      client_id: DAEMON,
      client_secret: SEED.daemonSecret,
      scope: 'api://not-registered/.default',
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as CcBody).error).toBe('invalid_scope');
  });

  it('rejects .default combined with openid with invalid_scope', async () => {
    ctx = await buildTestApp();
    const res = await token(ctx, {
      client_id: DAEMON,
      client_secret: SEED.daemonSecret,
      scope: `openid ${DAEMON_DEFAULT}`,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as CcBody).error).toBe('invalid_scope');
  });

  it('rejects .default combined with offline_access with invalid_scope', async () => {
    ctx = await buildTestApp();
    const res = await token(ctx, {
      client_id: DAEMON,
      client_secret: SEED.daemonSecret,
      scope: `${DAEMON_DEFAULT} offline_access`,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as CcBody).error).toBe('invalid_scope');
  });
});

// ---------------------------------------------------------------------------
// Criterion 6 — audience resolution (exact aud values)
// ---------------------------------------------------------------------------
describe('audience resolution (criterion 6)', () => {
  async function audFor(app: TestApp, scope: string): Promise<unknown> {
    const res = await token(app, {
      client_id: DAEMON,
      client_secret: SEED.daemonSecret,
      scope,
    });
    expect(res.statusCode).toBe(200);
    const set = await jwks(app);
    const { payload } = await jwtVerify((res.json() as CcBody).access_token as string, set);
    return payload.aud;
  }

  it('resolves Graph .default to aud=GRAPH_RESOURCE_ID', async () => {
    ctx = await buildTestApp();
    expect(await audFor(ctx, GRAPH_DEFAULT)).toBe(GRAPH);
  });

  it('resolves api://<appId>/.default to aud=api://<appId> (the URI string)', async () => {
    ctx = await buildTestApp();
    expect(await audFor(ctx, DAEMON_DEFAULT)).toBe(DAEMON_URI);
  });

  it('resolves bare <appId GUID>/.default to aud=<appId>', async () => {
    ctx = await buildTestApp();
    expect(await audFor(ctx, `${DAEMON}/.default`)).toBe(DAEMON);
  });
});

// ---------------------------------------------------------------------------
// Criterion 7 — no persistence (no refresh/code/session rows written)
// ---------------------------------------------------------------------------
describe('no persistence (criterion 7)', () => {
  it('writes no refresh_tokens/authorization_codes/sessions rows', async () => {
    ctx = await buildTestApp();
    const db = ctx.app.store.db;
    const counts = () => ({
      refresh: (db.prepare('SELECT COUNT(*) AS c FROM refresh_tokens').get() as { c: number }).c,
      codes: (db.prepare('SELECT COUNT(*) AS c FROM authorization_codes').get() as { c: number }).c,
      sessions: (db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c,
    });
    const before = counts();
    const res = await token(ctx, {
      client_id: DAEMON,
      client_secret: SEED.daemonSecret,
      scope: DAEMON_DEFAULT,
    });
    expect(res.statusCode).toBe(200);
    expect(counts()).toEqual(before);
  });
});
