import type { Store } from '../store/store.js';
import { sha256 } from '../store/hashing.js';
import { generateOpaqueToken } from './authCode.js';

/**
 * Refresh-token issuance + redemption-with-rotation contract (spec #5), consumed by #7. Tokens are
 * opaque high-entropy base64url strings returned to the client and stored **hashed** (SHA-256, the
 * PK) in `refresh_tokens` (#2). Every redemption rotates: the presented token is revoked and a new
 * one issued, chained via `rotated_from`. Requested scopes must be a subset of the original grant.
 */

export interface IssueRefreshTokenParams {
  appId: string;
  userId: string;
  scopes: readonly string[];
  resource?: string | null;
  rotatedFrom?: string | null;
}

export interface RedeemRefreshTokenParams {
  token: string;
  appId: string;
  /** Optional scope-down; must be a subset of the original grant. Defaults to the original. */
  requestedScopes?: readonly string[];
}

export type RedeemRefreshTokenResult =
  | {
      ok: true;
      userId: string;
      scopes: string[];
      resource: string | null;
      newRefreshToken: string;
    }
  | { ok: false; error: 'invalid_grant' | 'invalid_scope'; detail: string };

export interface RefreshTokenService {
  issueRefreshToken(params: IssueRefreshTokenParams): string;
  redeemRefreshToken(params: RedeemRefreshTokenParams): RedeemRefreshTokenResult;
}

/**
 * Build the refresh-token service over the store, with an injected clock (seconds) and the
 * configured refresh-token lifetime.
 */
export function createRefreshTokenService(
  store: Store,
  clock: () => number,
  lifetimeSeconds: number,
): RefreshTokenService {
  return {
    issueRefreshToken(params) {
      const token = generateOpaqueToken();
      store.refreshTokens.insert({
        token,
        appId: params.appId,
        userId: params.userId,
        scopes: params.scopes.join(' '),
        resource: params.resource ?? null,
        expiresAt: clock() + lifetimeSeconds,
        rotatedFrom: params.rotatedFrom ?? null,
      });
      return token;
    },

    redeemRefreshToken(params) {
      const invalidGrant = (detail: string): RedeemRefreshTokenResult => ({
        ok: false,
        error: 'invalid_grant',
        detail,
      });

      const oldHash = sha256(params.token);
      const row = store.refreshTokens.getByHash(oldHash);
      if (!row) return invalidGrant('unknown refresh token');
      if (row.revoked) {
        // Reuse/replay detection (takes precedence over expiry): the presented token was already
        // rotated/revoked. Revoke its entire rotation family (this chain only) so a leaked token can
        // mint nothing further, then fail. A still-active-but-expired token is handled below and is
        // NOT a replay, so it must not trigger family revocation.
        store.refreshTokens.revokeFamily(oldHash);
        return invalidGrant('refresh token reused');
      }
      if (row.expiresAt <= clock()) return invalidGrant('refresh token expired');
      if (row.appId !== params.appId) return invalidGrant('app_id mismatch');

      const originalScopes = row.scopes.length > 0 ? row.scopes.split(' ') : [];
      let scopes = originalScopes;
      if (params.requestedScopes && params.requestedScopes.length > 0) {
        const original = new Set(originalScopes);
        const over = params.requestedScopes.find((s) => !original.has(s));
        if (over !== undefined) {
          return { ok: false, error: 'invalid_scope', detail: `scope ${over} not in grant` };
        }
        scopes = [...params.requestedScopes];
      }

      // Rotate atomically: revoke the presented token and issue a chained replacement. A failure
      // here means the token was already revoked/missing (reuse or race) → invalid_grant.
      const newToken = generateOpaqueToken();
      const rotated = store.refreshTokens.rotate(oldHash, {
        token: newToken,
        appId: row.appId,
        userId: row.userId,
        scopes: scopes.join(' '),
        resource: row.resource,
        expiresAt: clock() + lifetimeSeconds,
      });
      if (!rotated) return invalidGrant('refresh token already used');

      return {
        ok: true,
        userId: row.userId,
        scopes,
        resource: row.resource,
        newRefreshToken: newToken,
      };
    },
  };
}
