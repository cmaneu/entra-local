/**
 * Shared Bearer-token helpers for the resource endpoints (#9 UserInfo, #10 Graph). The error-body
 * shape differs per surface (OIDC `{error,error_description}` vs Graph `{error:{code,message}}`), so
 * only the credential extraction — which is identical everywhere — lives here.
 */

/** Extract the bearer credential from an `Authorization: Bearer <token>` header (or `undefined`). */
export function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S.*)$/i.exec(header.trim());
  return match ? (match[1] as string).trim() : undefined;
}
