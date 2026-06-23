import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Store } from '../store/store.js';

/**
 * Authorization-code issuance + redemption contract (spec #5), consumed by #6. Codes are opaque,
 * high-entropy (256-bit) base64url strings persisted to `authorization_codes` (#2) and are
 * single-use: redemption validates the app/redirect/PKCE binding and atomically consumes the row.
 * #5 owns the PKCE verifier check here even though #6 owns the HTTP-layer client authentication.
 */

/** Opaque-token entropy: 32 bytes → 256 bits, base64url-encoded. */
const TOKEN_BYTES = 32;

/** Generate a fresh opaque high-entropy base64url token (auth codes, refresh tokens). */
export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export interface IssueAuthCodeParams {
  appId: string;
  userId: string;
  redirectUri: string;
  scopes: readonly string[];
  resource?: string | null;
  codeChallenge?: string | null;
  codeChallengeMethod?: string | null;
  nonce?: string | null;
}

export interface RedeemAuthCodeParams {
  code: string;
  appId: string;
  redirectUri: string;
  codeVerifier?: string | null;
}

export type RedeemAuthCodeResult =
  | {
      ok: true;
      userId: string;
      scopes: string[];
      resource: string | null;
      nonce: string | null;
    }
  | { ok: false; error: 'invalid_grant'; detail: string };

/** Verify a PKCE code verifier against a stored challenge per RFC 7636 (S256 / plain). */
function verifyPkce(challenge: string, method: string | null, verifier: string): boolean {
  // RFC 7636: absent method defaults to "plain".
  const m = (method ?? 'plain').toLowerCase();
  if (m === 's256') {
    const computed = createHash('sha256').update(verifier, 'ascii').digest('base64url');
    return timingSafeEqualStr(computed, challenge);
  }
  if (m === 'plain') {
    return timingSafeEqualStr(verifier, challenge);
  }
  return false;
}

/** Constant-time string compare (length-safe). */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface AuthCodeService {
  issueAuthCode(params: IssueAuthCodeParams): string;
  redeemAuthCode(params: RedeemAuthCodeParams): RedeemAuthCodeResult;
}

/**
 * Build the authorization-code service over the store, with an injected clock (seconds) and the
 * configured auth-code lifetime.
 */
export function createAuthCodeService(
  store: Store,
  clock: () => number,
  lifetimeSeconds: number,
): AuthCodeService {
  return {
    issueAuthCode(params) {
      const code = generateOpaqueToken();
      store.authCodes.insert({
        code,
        appId: params.appId,
        userId: params.userId,
        redirectUri: params.redirectUri,
        scopes: params.scopes.join(' '),
        resource: params.resource ?? null,
        codeChallenge: params.codeChallenge ?? null,
        codeChallengeMethod: params.codeChallengeMethod ?? null,
        nonce: params.nonce ?? null,
        expiresAt: clock() + lifetimeSeconds,
      });
      return code;
    },

    redeemAuthCode(params) {
      const invalid = (detail: string): RedeemAuthCodeResult => ({
        ok: false,
        error: 'invalid_grant',
        detail,
      });

      const row = store.authCodes.getByCode(params.code);
      if (!row) return invalid('unknown code');
      if (row.consumed) return invalid('code already used');
      if (row.expiresAt <= clock()) return invalid('code expired');
      if (row.appId !== params.appId) return invalid('app_id mismatch');
      if (row.redirectUri !== params.redirectUri) return invalid('redirect_uri mismatch');

      if (row.codeChallenge != null) {
        if (!params.codeVerifier) return invalid('PKCE verifier required');
        if (!verifyPkce(row.codeChallenge, row.codeChallengeMethod, params.codeVerifier)) {
          return invalid('PKCE verification failed');
        }
      }

      // Atomic single-use guard (race-safe): only the first redemption consumes the row.
      const consumed = store.authCodes.consume(params.code);
      if (!consumed) return invalid('code already used');

      return {
        ok: true,
        userId: row.userId,
        scopes: row.scopes.length > 0 ? row.scopes.split(' ') : [],
        resource: row.resource,
        nonce: row.nonce,
      };
    },
  };
}
