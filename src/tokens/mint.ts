import { SignJWT } from 'jose';
import type { SigningService } from './keys.js';
import { SIGNING_ALG } from './keys.js';
import type { AccessTokenClaims, IdTokenClaims } from './claims.js';

/**
 * RS256-sign assembled claim sets into compact JWTs. The protected header is fixed
 * `{ alg:'RS256', typ:'JWT', kid:<active kid> }`; the active signer comes from feature #3
 * (`app.signing.getActiveSigner`). These functions never assemble claims — that is `claims.ts`.
 */

/** Sign an already-assembled claim payload with the tenant's active signing key. */
async function sign(
  signing: SigningService,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const signer = await signing.getActiveSigner(tenantId);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: SIGNING_ALG, typ: 'JWT', kid: signer.kid })
    .sign(signer.privateKey);
}

/** Mint a signed ID token from assembled ID-token claims. */
export function mintIdToken(
  signing: SigningService,
  tenantId: string,
  claims: IdTokenClaims,
): Promise<string> {
  return sign(signing, tenantId, { ...claims });
}

/** Mint a signed access token from assembled access-token claims. */
export function mintAccessToken(
  signing: SigningService,
  tenantId: string,
  claims: AccessTokenClaims,
): Promise<string> {
  return sign(signing, tenantId, { ...claims });
}
