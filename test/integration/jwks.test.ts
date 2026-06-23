import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalJWKSet, jwtVerify, SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { makeTestConfig, TEST_TENANT_ID, TMP_DIR } from '../helpers/constants.js';
import { TEST_SIGNING_KID } from '../helpers/signingKeyFixture.js';

const JWKS_URL = `/${TEST_TENANT_ID}/discovery/v2.0/keys`;

interface JwkSetBody {
  keys: Record<string, unknown>[];
}

let ctx: TestApp;

afterEach(async () => {
  await ctx?.close();
});

describe('JWKS endpoint shape (criterion 2)', () => {
  it('returns a 200 JWK Set with public-only RSA components', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({ method: 'GET', url: JWKS_URL });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const body = res.json() as JwkSetBody;
    expect(Array.isArray(body.keys)).toBe(true);
    expect(body.keys).toHaveLength(1);

    const key = body.keys[0]!;
    expect(key.kty).toBe('RSA');
    expect(key.use).toBe('sig');
    expect(key.alg).toBe('RS256');
    expect(key.kid).toBe(TEST_SIGNING_KID);
    expect(typeof key.n).toBe('string');
    expect(key.e).toBe('AQAB');

    // No private components or extraneous fields.
    for (const priv of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
      expect(key).not.toHaveProperty(priv);
    }
    expect(Object.keys(key).sort()).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
  });
});

describe('JWKS endpoint alias parity (criterion 3)', () => {
  it('returns the same key set for the GUID and every literal alias', async () => {
    ctx = await buildTestApp();
    const bodies: string[] = [];
    for (const tenant of [TEST_TENANT_ID, 'common', 'organizations', 'consumers']) {
      const res = await ctx.inject({ method: 'GET', url: `/${tenant}/discovery/v2.0/keys` });
      expect(res.statusCode, tenant).toBe(200);
      bodies.push(res.body);
    }
    for (const body of bodies) {
      expect(body).toBe(bodies[0]);
    }
  });

  it('rejects an unknown tenant with a JSON 404 (never the SPA)', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({ method: 'GET', url: '/badtenant/discovery/v2.0/keys' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('tenant_not_found');
  });
});

describe('JWKS cache headers (criterion 6)', () => {
  it('sets Cache-Control with a non-zero max-age', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({ method: 'GET', url: JWKS_URL });
    const cacheControl = res.headers['cache-control'];
    expect(cacheControl).toBeDefined();
    expect(cacheControl).toContain('public');
    const match = /max-age=(\d+)/.exec(String(cacheControl));
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(0);
  });
});

describe('JWKS determinism with the fixed test key (criterion 8)', () => {
  it('produces byte-identical JWKS bodies across independent boots', async () => {
    const a = await buildTestApp();
    const b = await buildTestApp();
    try {
      const resA = await a.inject({ method: 'GET', url: JWKS_URL });
      const resB = await b.inject({ method: 'GET', url: JWKS_URL });
      expect(resA.body).toBe(resB.body);
    } finally {
      await a.close();
      await b.close();
    }
  });
});

describe('signing-key bootstrap (criterion 1)', () => {
  it('generates exactly one active key on first boot and reuses it on reboot', async () => {
    mkdirSync(TMP_DIR, { recursive: true });
    const dbPath = join(TMP_DIR, `${randomUUID()}.db`);
    const config = makeTestConfig(dbPath);

    // First boot against an empty DB → real key generation (no pre-seeded key).
    const app1 = await buildApp(config);
    const keys1 = app1.store.signingKeys.listPublic(TEST_TENANT_ID);
    expect(keys1).toHaveLength(1);
    expect(keys1[0]!.isActive).toBe(true);
    const jwks1 = app1.signing.listJwks(TEST_TENANT_ID);
    await app1.close();

    // Second boot against the same DB file → reuse (identical kid + modulus, no new key).
    const app2 = await buildApp(config);
    const keys2 = app2.store.signingKeys.listPublic(TEST_TENANT_ID);
    const jwks2 = app2.signing.listJwks(TEST_TENANT_ID);
    expect(keys2).toHaveLength(1);
    expect(jwks2.keys[0]!.kid).toBe(jwks1.keys[0]!.kid);
    expect(jwks2.keys[0]!.n).toBe(jwks1.keys[0]!.n);
    await app2.close();

    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  });
});

describe('sign → verify round-trip against the JWKS endpoint (criterion 5)', () => {
  it('verifies a JWT signed by getActiveSigner using the published JWKS', async () => {
    ctx = await buildTestApp();
    const signer = await ctx.app.signing.getActiveSigner(TEST_TENANT_ID);

    const jwt = await new SignJWT({ scope: 'test' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: signer.kid })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(signer.privateKey);

    const res = await ctx.inject({ method: 'GET', url: JWKS_URL });
    const jwks = createLocalJWKSet(res.json() as JwkSetBody);

    const { payload, protectedHeader } = await jwtVerify(jwt, jwks);
    expect(protectedHeader.kid).toBe(signer.kid);
    expect(payload.scope).toBe('test');
  });

  it('fails verification when the token kid is altered', async () => {
    ctx = await buildTestApp();
    const signer = await ctx.app.signing.getActiveSigner(TEST_TENANT_ID);

    // Sign with a kid that is not present in the JWKS.
    const jwt = await new SignJWT({ scope: 'test' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'not-the-real-kid' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(signer.privateKey);

    const res = await ctx.inject({ method: 'GET', url: JWKS_URL });
    const jwks = createLocalJWKSet(res.json() as JwkSetBody);

    await expect(jwtVerify(jwt, jwks)).rejects.toThrow();
  });
});
