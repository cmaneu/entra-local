import { calculateJwkThumbprint, exportJWK, generateKeyPair, type JWK } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSigningService,
  generateSigningKey,
  RSA_MODULUS_LENGTH,
  SIGNING_ALG,
  toJwksKey,
} from '../../src/tokens/keys.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';
import { buildTestStore, type TestStore } from '../helpers/buildTestStore.js';
import {
  TEST_PRIVATE_PKCS8,
  TEST_PUBLIC_JWK,
  TEST_SIGNING_KID,
} from '../helpers/signingKeyFixture.js';

/** Build a minimal stored public JWK string for a fabricated key (only n/e matter to toJwksKey). */
function fakePublicJwk(n: string): string {
  return JSON.stringify({ kty: 'RSA', n, e: 'AQAB' });
}

describe('signing key generation (criterion 4)', () => {
  it('derives kid as the RFC 7638 thumbprint of the generated public JWK', async () => {
    const key = await generateSigningKey();
    expect(key.alg).toBe(SIGNING_ALG);

    const jwk = JSON.parse(key.publicJwk) as JWK;
    expect(jwk.kty).toBe('RSA');
    expect(typeof jwk.n).toBe('string');
    expect(jwk.e).toBe('AQAB');
    // The stored public JWK must never carry private components.
    for (const priv of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
      expect(jwk).not.toHaveProperty(priv);
    }

    const expectedKid = await calculateJwkThumbprint(jwk);
    expect(key.kid).toBe(expectedKid);
    expect(key.privatePkcs8).toContain('BEGIN PRIVATE KEY');
  });

  it('generates an RSA-2048 modulus (256-byte key)', async () => {
    const { publicKey } = await generateKeyPair(SIGNING_ALG, {
      modulusLength: RSA_MODULUS_LENGTH,
      extractable: true,
    });
    const jwk = await exportJWK(publicKey);
    // base64url of a 256-byte modulus → ceil(256/3)*4 ≈ 342-343 chars.
    expect(Buffer.from(jwk.n as string, 'base64url')).toHaveLength(256);
  });
});

describe('committed test key fixture integrity (criterion 8)', () => {
  it('the fixed kid equals the thumbprint of the fixed public JWK', async () => {
    const jwk = JSON.parse(TEST_PUBLIC_JWK) as JWK;
    expect(await calculateJwkThumbprint(jwk)).toBe(TEST_SIGNING_KID);
    expect(TEST_PRIVATE_PKCS8).toContain('BEGIN PRIVATE KEY');
  });
});

describe('toJwksKey projection (criterion 2)', () => {
  it('exposes only public JWK fields and the fixed sig/alg metadata', () => {
    const entry = toJwksKey({
      kid: 'k1',
      tenantId: TEST_TENANT_ID,
      alg: 'RS256',
      publicJwk: fakePublicJwk('abc'),
      isActive: true,
      createdAt: 0,
      notAfter: null,
    });
    expect(entry).toEqual({ kty: 'RSA', use: 'sig', alg: 'RS256', kid: 'k1', n: 'abc', e: 'AQAB' });
  });

  it('throws if a stored JWK is missing n/e (never leaks malformed material)', () => {
    expect(() =>
      toJwksKey({
        kid: 'bad',
        tenantId: TEST_TENANT_ID,
        alg: 'RS256',
        publicJwk: '{"kty":"RSA"}',
        isActive: true,
        createdAt: 0,
        notAfter: null,
      }),
    ).toThrow(/missing n\/e/);
  });
});

describe('signing service JWKS filtering / rotation-readiness (criterion 7)', () => {
  let ctx: TestStore;
  const NOW = 2_000_000_000;

  beforeEach(() => {
    ctx = buildTestStore();
    ctx.store.seed();
  });

  afterEach(() => {
    ctx.close();
  });

  it('lists active + retired-but-unexpired keys and excludes retired keys past not_after', () => {
    const { signingKeys } = ctx.store;
    // A: retired (inactive) but not_after in the future → must be published.
    signingKeys.insert({
      kid: 'A',
      tenantId: TEST_TENANT_ID,
      publicJwk: fakePublicJwk('nA'),
      privatePkcs8: 'x',
      isActive: false,
      notAfter: NOW + 3600,
    });
    // C: retired (inactive) and already past not_after → must be excluded.
    signingKeys.insert({
      kid: 'C',
      tenantId: TEST_TENANT_ID,
      publicJwk: fakePublicJwk('nC'),
      privatePkcs8: 'x',
      isActive: false,
      notAfter: NOW - 10,
    });
    // B: the new active signer (no expiry).
    signingKeys.insert({
      kid: 'B',
      tenantId: TEST_TENANT_ID,
      publicJwk: fakePublicJwk('nB'),
      privatePkcs8: 'x',
      isActive: true,
      notAfter: null,
    });

    const svc = createSigningService(ctx.store, () => NOW);
    const kids = svc.listJwks(TEST_TENANT_ID).keys.map((k) => k.kid);
    expect(kids).toContain('A');
    expect(kids).toContain('B');
    expect(kids).not.toContain('C');
  });
});

describe('signing service accessors (criterion 5 inputs)', () => {
  let ctx: TestStore;

  beforeEach(() => {
    ctx = buildTestStore();
    ctx.store.seed();
  });

  afterEach(() => {
    ctx.close();
  });

  it('getActiveSigner returns the active kid + an importable private key', async () => {
    ctx.store.signingKeys.insert({
      kid: TEST_SIGNING_KID,
      tenantId: TEST_TENANT_ID,
      publicJwk: TEST_PUBLIC_JWK,
      privatePkcs8: TEST_PRIVATE_PKCS8,
      isActive: true,
    });
    const svc = createSigningService(ctx.store);
    const signer = await svc.getActiveSigner(TEST_TENANT_ID);
    expect(signer.kid).toBe(TEST_SIGNING_KID);
    expect(signer.alg).toBe('RS256');
    expect(signer.privateKey.type).toBe('private');

    const verify = await svc.getVerificationKey(TEST_SIGNING_KID);
    expect(verify.type).toBe('public');
  });

  it('getActiveSigner throws when no active key exists', async () => {
    const svc = createSigningService(ctx.store);
    await expect(svc.getActiveSigner(TEST_TENANT_ID)).rejects.toThrow(/No active signing key/);
  });

  it('getVerificationKey throws for an unknown kid', async () => {
    const svc = createSigningService(ctx.store);
    await expect(svc.getVerificationKey('nope')).rejects.toThrow(/No signing key with kid/);
  });
});
