import {
  calculateJwkThumbprint,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  importJWK,
  importPKCS8,
  type JWK,
} from 'jose';
import type { Store } from '../store/store.js';
import type { PublicSigningKey, SigningKey } from '../store/types.js';
import { systemClock, type Clock } from '../store/util.js';

/** The only signing algorithm in MVP (matches Entra v2 defaults / MSAL expectations). */
export const SIGNING_ALG = 'RS256' as const;
export type SigningAlg = typeof SIGNING_ALG;

/** RSA modulus length for generated signing keys. */
export const RSA_MODULUS_LENGTH = 2048;

/**
 * The runtime key type jose returns from `importPKCS8` (the WebCrypto key). Derived from
 * jose's own signature so we don't depend on a DOM/global `CryptoKey` lib being configured.
 */
export type SigningCryptoKey = Awaited<ReturnType<typeof importPKCS8>>;

/** Freshly generated key material, ready to persist via the `signing_keys` repository. */
export interface GeneratedSigningKey {
  /** RFC 7638 JWK thumbprint of the public JWK (content-stable). */
  kid: string;
  /** JSON-serialized public JWK (`{ kty, n, e }`) — never contains private components. */
  publicJwk: string;
  /** PKCS#8 PEM private key. Stored locally; dev-tool only. */
  privatePkcs8: string;
  alg: SigningAlg;
}

/** A single public key entry in a JWK Set (only RSA public components are exposed). */
export interface JwksKey {
  kty: 'RSA';
  use: 'sig';
  alg: SigningAlg;
  kid: string;
  n: string;
  e: string;
}

/** A JWK Set as returned by the JWKS endpoint. */
export interface JwkSet {
  keys: JwksKey[];
}

/** The active signer handed to #5 for minting tokens. */
export interface ActiveSigner {
  kid: string;
  /** Imported private key, ready to pass to jose's `SignJWT().sign(...)`. */
  privateKey: SigningCryptoKey;
  alg: SigningAlg;
}

/**
 * Generate a fresh RSA-2048 / RS256 signing key. The `kid` is the RFC 7638 JWK thumbprint of the
 * public JWK, so it is stable and derived purely from the key material.
 */
export async function generateSigningKey(): Promise<GeneratedSigningKey> {
  const { publicKey, privateKey } = await generateKeyPair(SIGNING_ALG, {
    modulusLength: RSA_MODULUS_LENGTH,
    extractable: true,
  });
  const jwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(jwk);
  const privatePkcs8 = await exportPKCS8(privateKey);
  return { kid, publicJwk: JSON.stringify(jwk), privatePkcs8, alg: SIGNING_ALG };
}

/**
 * Project a stored public signing key into a JWK Set entry. Reconstructs the entry from `n`/`e`
 * only, so private material can never leak even if a malformed JWK were stored.
 */
export function toJwksKey(key: PublicSigningKey): JwksKey {
  const jwk = JSON.parse(key.publicJwk) as JWK;
  if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
    throw new Error(`Stored public JWK for kid ${key.kid} is missing n/e`);
  }
  return { kty: 'RSA', use: 'sig', alg: SIGNING_ALG, kid: key.kid, n: jwk.n, e: jwk.e };
}

/**
 * Ensure the tenant has an active signing key. On an empty `signing_keys` table this generates and
 * persists exactly one active RSA key; if one already exists (e.g. a prior boot, or a pre-seeded
 * deterministic test key) it is reused unchanged — giving a stable `kid`/signature across restarts.
 */
export async function ensureActiveKey(store: Store, tenantId: string): Promise<SigningKey> {
  const existing = store.signingKeys.getActive(tenantId);
  if (existing) return existing;
  const generated = await generateSigningKey();
  return store.signingKeys.insert({
    kid: generated.kid,
    tenantId,
    alg: generated.alg,
    publicJwk: generated.publicJwk,
    privatePkcs8: generated.privatePkcs8,
    isActive: true,
  });
}

/**
 * Signing-key accessors shared across features. Owns the in-memory import cache so private/public
 * keys are imported once per `kid`. Exposed to the rest of the app as the `app.signing` decorator;
 * #5 (token service) consumes `getActiveSigner`, #5/#10 use `getVerificationKey`.
 */
export interface SigningService {
  /** Bootstrap helper: generate+persist an active key if none exists; otherwise reuse. */
  ensureActiveKey(tenantId: string): Promise<SigningKey>;
  /** The active private signer for `tenantId` (throws if none — bootstrap guarantees one). */
  getActiveSigner(tenantId: string): Promise<ActiveSigner>;
  /** The public key for a given `kid`, for verifying a token's signature (throws if unknown). */
  getVerificationKey(kid: string): Promise<SigningCryptoKey>;
  /** The JWK Set for a tenant: active keys plus any retired-but-unexpired keys. */
  listJwks(tenantId: string): JwkSet;
}

/**
 * Build the signing service over the store. The `clock` drives `not_after` filtering for the JWKS
 * (retired keys past `not_after` are excluded); it defaults to wall-clock and is injectable for
 * deterministic tests.
 */
export function createSigningService(store: Store, clock: Clock = systemClock): SigningService {
  const privateCache = new Map<string, SigningCryptoKey>();
  const publicCache = new Map<string, SigningCryptoKey>();

  return {
    ensureActiveKey: (tenantId) => ensureActiveKey(store, tenantId),

    async getActiveSigner(tenantId) {
      const active = store.signingKeys.getActive(tenantId);
      if (!active) {
        throw new Error(`No active signing key for tenant ${tenantId}`);
      }
      let privateKey = privateCache.get(active.kid);
      if (!privateKey) {
        privateKey = (await importPKCS8(active.privatePkcs8, active.alg)) as SigningCryptoKey;
        privateCache.set(active.kid, privateKey);
      }
      return { kid: active.kid, privateKey, alg: SIGNING_ALG };
    },

    async getVerificationKey(kid) {
      let publicKey = publicCache.get(kid);
      if (!publicKey) {
        const row = store.signingKeys.getByKid(kid);
        if (!row) {
          throw new Error(`No signing key with kid ${kid}`);
        }
        const jwk = JSON.parse(row.publicJwk) as JWK;
        publicKey = (await importJWK({ ...jwk, alg: row.alg }, row.alg)) as SigningCryptoKey;
        publicCache.set(kid, publicKey);
      }
      return publicKey;
    },

    listJwks(tenantId) {
      const now = clock();
      const keys = store.signingKeys
        .listPublic(tenantId)
        .filter((k) => k.isActive || k.notAfter == null || k.notAfter > now)
        .map(toJwksKey);
      return { keys };
    },
  };
}
