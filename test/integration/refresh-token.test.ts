import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256 } from '../../src/store/hashing.js';
import { SEED } from '../../src/store/seed.js';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';

/**
 * Integration tests for feature #7 — Refresh Token flow (silent renewal with rotation +
 * reuse-detection / family-revocation). Exercises the `grant_type=refresh_token` branch of the
 * `/token` endpoint in-process via `app.inject`, covering acceptance criteria 1–10. The real-MSAL
 * silent-renewal flow (criterion 11) lives in the e2e suite.
 */

const T = TEST_TENANT_ID;
const TOKEN_PATH = `/${T}/oauth2/v2.0/token`;
const KEYS_PATH = `/${T}/discovery/v2.0/keys`;
const SPA = SEED.appSpaId;
const DAEMON = SEED.appDaemonId;
const SPA_RESOURCE = `api://${SPA}`;
const SPA_SCOPE = `${SPA_RESOURCE}/${SEED.spaScopeValue}`;
const DELEGATED_SCOPES = ['openid', 'profile', 'offline_access', SPA_SCOPE];

const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded' };

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

/** Form-encode a record for an `application/x-www-form-urlencoded` body. */
function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

/** Issue a refresh token bound to an app/user directly via the token service (skips the #6 flow). */
function issueRefresh(
  app: TestApp,
  opts: {
    appId?: string;
    userId?: string;
    scopes?: readonly string[];
    resource?: string | null;
  } = {},
): string {
  return app.app.tokenService.issueRefreshToken({
    appId: opts.appId ?? SPA,
    userId: opts.userId ?? SEED.userAliceId,
    scopes: opts.scopes ?? DELEGATED_SCOPES,
    resource: opts.resource === undefined ? SPA_RESOURCE : opts.resource,
  });
}

/** POST the refresh_token grant and return the raw inject response. */
async function redeem(
  app: TestApp,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) {
  return await app.inject({
    method: 'POST',
    url: TOKEN_PATH,
    headers: { ...FORM_HEADERS, ...headers },
    payload: form({ grant_type: 'refresh_token', ...fields }),
  });
}

async function jwks(app: TestApp): Promise<ReturnType<typeof createLocalJWKSet>> {
  const res = await app.inject({ method: 'GET', url: KEYS_PATH });
  return createLocalJWKSet(JSON.parse(res.body) as JSONWebKeySet);
}

interface RefreshBody {
  token_type?: string;
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  client_info?: string;
  scope?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Criterion 1 — happy-path rotation (new access/id/refresh, no-store)
// ---------------------------------------------------------------------------
describe('happy-path rotation (criterion 1)', () => {
  it('returns a new access + id token and a different refresh token with no-store', async () => {
    ctx = await buildTestApp();
    const token = issueRefresh(ctx);
    const res = await redeem(ctx, { refresh_token: token, client_id: SPA });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['pragma']).toContain('no-cache');
    const body = res.json() as RefreshBody;
    expect(body.token_type).toBe('Bearer');
    expect(body.access_token).toMatch(/.+/);
    expect(body.id_token).toMatch(/.+/); // openid was in the grant → re-minted ID token
    expect(body.refresh_token).toMatch(/.+/);
    expect(body.refresh_token).not.toBe(token); // rotated
    expect(body.client_info).toMatch(/.+/);
  });
});

// ---------------------------------------------------------------------------
// Criterion 2 — old token revoked after rotation
// ---------------------------------------------------------------------------
describe('old token revoked (criterion 2)', () => {
  it('rejects the previous refresh token after a successful rotation', async () => {
    ctx = await buildTestApp();
    const token = issueRefresh(ctx);
    expect((await redeem(ctx, { refresh_token: token, client_id: SPA })).statusCode).toBe(200);

    const replay = await redeem(ctx, { refresh_token: token, client_id: SPA });
    expect(replay.statusCode).toBe(400);
    expect((replay.json() as RefreshBody).error).toBe('invalid_grant');
  });
});

// ---------------------------------------------------------------------------
// Criterion 3 — reuse → family revocation
// ---------------------------------------------------------------------------
describe('reuse → family revocation (criterion 3)', () => {
  it('replaying A revokes the whole chain so the live successor B also fails', async () => {
    ctx = await buildTestApp();
    const a = issueRefresh(ctx);
    const first = await redeem(ctx, { refresh_token: a, client_id: SPA });
    expect(first.statusCode).toBe(200);
    const b = (first.json() as RefreshBody).refresh_token as string;
    expect(b).toMatch(/.+/);

    // Replay the already-rotated token A → reuse → invalid_grant (+ family revoked).
    const replay = await redeem(ctx, { refresh_token: a, client_id: SPA });
    expect(replay.statusCode).toBe(400);
    expect((replay.json() as RefreshBody).error).toBe('invalid_grant');

    // The live descendant B is now revoked too (whole family killed).
    const useB = await redeem(ctx, { refresh_token: b, client_id: SPA });
    expect(useB.statusCode).toBe(400);
    expect((useB.json() as RefreshBody).error).toBe('invalid_grant');
  });

  it('does not affect an independent sign-in chain for the same user+app', async () => {
    ctx = await buildTestApp();
    const chain1A = issueRefresh(ctx);
    const chain2A = issueRefresh(ctx); // a separate sign-in (separate root)

    // Rotate + reuse chain 1.
    const b1 = (
      (await redeem(ctx, { refresh_token: chain1A, client_id: SPA })).json() as RefreshBody
    ).refresh_token as string;
    expect((await redeem(ctx, { refresh_token: chain1A, client_id: SPA })).statusCode).toBe(400);
    expect((await redeem(ctx, { refresh_token: b1, client_id: SPA })).statusCode).toBe(400);

    // Chain 2 is untouched and still redeemable.
    const res = await redeem(ctx, { refresh_token: chain2A, client_id: SPA });
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Criterion 4 — offline_access gating
// ---------------------------------------------------------------------------
describe('offline_access gating (criterion 4)', () => {
  it('returns a new refresh token when offline_access is in the grant', async () => {
    ctx = await buildTestApp();
    const token = issueRefresh(ctx);
    const body = (
      await redeem(ctx, { refresh_token: token, client_id: SPA })
    ).json() as RefreshBody;
    expect(body.refresh_token).toMatch(/.+/);
  });

  it('omits the new refresh token when narrowing drops offline_access', async () => {
    ctx = await buildTestApp();
    const token = issueRefresh(ctx);
    const res = await redeem(ctx, {
      refresh_token: token,
      client_id: SPA,
      scope: `openid ${SPA_SCOPE}`, // drop offline_access
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RefreshBody;
    expect(body.refresh_token).toBeUndefined();

    // The presented token is still rotated-and-revoked (cannot be reused).
    const replay = await redeem(ctx, { refresh_token: token, client_id: SPA });
    expect(replay.statusCode).toBe(400);
    expect((replay.json() as RefreshBody).error).toBe('invalid_grant');
  });
});

// ---------------------------------------------------------------------------
// Criterion 5 — scope narrowing
// ---------------------------------------------------------------------------
describe('scope narrowing (criterion 5)', () => {
  it('narrows to a subset and reflects it in scp/aud', async () => {
    ctx = await buildTestApp();
    const token = issueRefresh(ctx);
    const res = await redeem(ctx, {
      refresh_token: token,
      client_id: SPA,
      scope: `openid offline_access ${SPA_SCOPE}`, // drop profile
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RefreshBody;
    const set = await jwks(ctx);
    const access = await jwtVerify(body.access_token as string, set);
    expect(access.payload.aud).toBe(SPA);
    expect(access.payload.scp).toContain(SEED.spaScopeValue);
    expect(access.payload.scp).not.toContain('profile'); // narrowed away
  });

  it('rejects a scope outside the original grant with invalid_scope', async () => {
    ctx = await buildTestApp();
    const token = issueRefresh(ctx);
    const res = await redeem(ctx, {
      refresh_token: token,
      client_id: SPA,
      scope: 'openid Mail.Read', // not in the grant
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as RefreshBody).error).toBe('invalid_scope');
  });
});

// ---------------------------------------------------------------------------
// Criterion 6 — confidential client auth (post + basic; wrong/missing; public + secret)
// ---------------------------------------------------------------------------
describe('confidential client auth (criterion 6)', () => {
  /** Issue a delegated refresh token bound to the confidential daemon app. */
  function daemonToken(app: TestApp): string {
    return issueRefresh(app, {
      appId: DAEMON,
      scopes: ['openid', 'offline_access'],
      resource: null,
    });
  }

  it('accepts client_secret_post', async () => {
    ctx = await buildTestApp();
    const token = daemonToken(ctx);
    const res = await redeem(ctx, {
      refresh_token: token,
      client_id: DAEMON,
      client_secret: SEED.daemonSecret,
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts client_secret_basic', async () => {
    ctx = await buildTestApp();
    const token = daemonToken(ctx);
    const basic = Buffer.from(`${DAEMON}:${SEED.daemonSecret}`, 'utf8').toString('base64');
    const res = await redeem(
      ctx,
      { refresh_token: token, client_id: DAEMON },
      { authorization: `Basic ${basic}` },
    );
    expect(res.statusCode).toBe(200);
  });

  it('rejects a wrong client_secret with invalid_client (401)', async () => {
    ctx = await buildTestApp();
    const token = daemonToken(ctx);
    const res = await redeem(ctx, {
      refresh_token: token,
      client_id: DAEMON,
      client_secret: 'wrong',
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as RefreshBody).error).toBe('invalid_client');
  });

  it('rejects a missing client_secret for a confidential client with invalid_client', async () => {
    ctx = await buildTestApp();
    const token = daemonToken(ctx);
    const res = await redeem(ctx, { refresh_token: token, client_id: DAEMON });
    expect(res.statusCode).toBe(401);
    expect((res.json() as RefreshBody).error).toBe('invalid_client');
  });

  it('rejects a public client that presents a secret with invalid_client', async () => {
    ctx = await buildTestApp();
    const token = issueRefresh(ctx);
    const res = await redeem(ctx, {
      refresh_token: token,
      client_id: SPA,
      client_secret: 'should-not-be-here',
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as RefreshBody).error).toBe('invalid_client');
  });
});

// ---------------------------------------------------------------------------
// Criterion 7 — client_id ↔ token binding
// ---------------------------------------------------------------------------
describe('client_id binding (criterion 7)', () => {
  it('rejects a client_id that does not match the token-bound app with invalid_grant', async () => {
    ctx = await buildTestApp();
    const token = issueRefresh(ctx); // bound to the SPA
    // Authenticate as the daemon (valid secret) but present the SPA-bound token.
    const res = await redeem(ctx, {
      refresh_token: token,
      client_id: DAEMON,
      client_secret: SEED.daemonSecret,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as RefreshBody).error).toBe('invalid_grant');
  });
});

// ---------------------------------------------------------------------------
// Criterion 8 — expiry of a still-active token (no family revocation; fresh TTL)
// ---------------------------------------------------------------------------
describe('expiry (criterion 8)', () => {
  it('rejects an expired-but-active token without revoking its family; new tokens get fresh TTL', async () => {
    ctx = await buildTestApp();
    const repo = ctx.app.store.refreshTokens;
    const now = Math.floor(Date.now() / 1000);

    // A live parent P and an expired (but un-revoked) child Q chained from it.
    const p = 'parent-token-' + Math.random().toString(36).slice(2);
    const q = 'child-token-' + Math.random().toString(36).slice(2);
    repo.insert({
      token: p,
      appId: SPA,
      userId: SEED.userAliceId,
      scopes: DELEGATED_SCOPES.join(' '),
      resource: SPA_RESOURCE,
      expiresAt: now + 100_000,
    });
    repo.insert({
      token: q,
      appId: SPA,
      userId: SEED.userAliceId,
      scopes: DELEGATED_SCOPES.join(' '),
      resource: SPA_RESOURCE,
      expiresAt: now - 10, // already expired
      rotatedFrom: sha256(p),
    });

    // Redeeming the expired (still-active) child → invalid_grant, no family revocation.
    const expired = await redeem(ctx, { refresh_token: q, client_id: SPA });
    expect(expired.statusCode).toBe(400);
    expect((expired.json() as RefreshBody).error).toBe('invalid_grant');

    // The parent survives (family was NOT revoked) and rotates to a fresh token with fresh TTL.
    const ok = await redeem(ctx, { refresh_token: p, client_id: SPA });
    expect(ok.statusCode).toBe(200);
    const newRt = (ok.json() as RefreshBody).refresh_token as string;
    const newRow = repo.getByHash(sha256(newRt));
    expect(newRow).toBeDefined();
    // Fresh rolling TTL ≈ now + refreshToken lifetime (86400 in the test config).
    expect(newRow!.expiresAt).toBeGreaterThan(now + 86_000);
  });
});

// ---------------------------------------------------------------------------
// Criterion 9 — concurrency atomicity
// ---------------------------------------------------------------------------
describe('concurrency atomicity (criterion 9)', () => {
  it('two concurrent redemptions yield exactly one 200 and one invalid_grant; one successor row', async () => {
    ctx = await buildTestApp();
    const token = issueRefresh(ctx);

    const [r1, r2] = await Promise.all([
      redeem(ctx, { refresh_token: token, client_id: SPA }),
      redeem(ctx, { refresh_token: token, client_id: SPA }),
    ]);

    const statuses = [r1.statusCode, r2.statusCode].sort();
    expect(statuses).toEqual([200, 400]);
    const loser = r1.statusCode === 400 ? r1 : r2;
    expect((loser.json() as RefreshBody).error).toBe('invalid_grant');

    // Exactly one successor was minted from the presented token (no double-mint).
    const successors = ctx.app.store.db
      .prepare('SELECT COUNT(*) AS c FROM refresh_tokens WHERE rotated_from = ?')
      .get(sha256(token)) as { c: number };
    expect(successors.c).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Criterion 10 — token conformance (JWKS verify; iss/aud/scp/ver; client_info)
// ---------------------------------------------------------------------------
describe('token conformance (criterion 10)', () => {
  it('refreshed access + id tokens verify against JWKS with the right claims; client_info decodes', async () => {
    ctx = await buildTestApp();
    const token = issueRefresh(ctx);
    const res = await redeem(ctx, { refresh_token: token, client_id: SPA });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RefreshBody;
    const set = await jwks(ctx);

    const access = await jwtVerify(body.access_token as string, set);
    expect(access.payload.iss).toBe(ctx.config.issuer);
    expect(access.payload.aud).toBe(SPA);
    expect(access.payload.scp).toContain(SEED.spaScopeValue);
    expect(access.payload.ver).toBe('2.0');

    const id = await jwtVerify(body.id_token as string, set);
    expect(id.payload.iss).toBe(ctx.config.issuer);
    expect(id.payload.aud).toBe(SPA);
    expect(id.payload.ver).toBe('2.0');

    const clientInfo = JSON.parse(
      Buffer.from(body.client_info as string, 'base64url').toString('utf8'),
    ) as { uid: string; utid: string };
    expect(clientInfo.uid).toBe(SEED.userAliceId);
    expect(clientInfo.utid).toBe(T);
  });
});
