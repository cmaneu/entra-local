import { createHash } from 'node:crypto';
import type { Config } from '../config/schema.js';
import type { Store } from '../store/store.js';
import type { AppRegistration, User } from '../store/types.js';

/**
 * Pure claim assembly for ID and access tokens. This module is the single source of truth for the
 * Entra-parity claim sets (spec #5 claim tables); `mint.ts` only signs the objects produced here.
 *
 * All `now`/lifetime values are integer Unix epoch **seconds** (matching the store clock). Nothing
 * here touches the database except the read-only `resolveAudience` lookup for resource apps.
 */

/** The constant token version stamped on every emulator-minted token (Entra v2 endpoint). */
export const TOKEN_VERSION = '2.0' as const;

/** OIDC/grant scopes that are not API permissions and never appear in an access token `scp`. */
const NON_RESOURCE_SCOPES = new Set(['offline_access']);

/** Assembled ID-token payload (claim names match the spec ID-token table verbatim). */
export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  nbf: number;
  tid: string;
  oid: string;
  name: string;
  preferred_username: string;
  ver: typeof TOKEN_VERSION;
  email?: string;
  nonce?: string;
  /** Configurable optional/group claims (feature: token configuration) are merged in at issuance. */
  [claim: string]: unknown;
}

/** Assembled access-token payload. Delegated vs app-only differences are captured by optionals. */
export interface AccessTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  nbf: number;
  tid: string;
  azp: string;
  appid: string;
  ver: typeof TOKEN_VERSION;
  /** Delegated only: the user's object id. */
  oid?: string;
  /** Delegated only: space-delimited granted resource scope names. */
  scp?: string;
  /** App-only only: granted app role values. */
  roles?: string[];
  /** Configurable optional/group claims (feature: token configuration) are merged in at issuance. */
  [claim: string]: unknown;
}

/**
 * Pairwise subject: stable, non-reversible per (user, app, tenant).
 * `sub = base64url(SHA-256(user.id + '|' + app.appId + '|' + tenantId))`.
 */
export function pairwiseSub(userId: string, appId: string, tenantId: string): string {
  return createHash('sha256').update(`${userId}|${appId}|${tenantId}`, 'utf8').digest('base64url');
}

/**
 * Strip a resource prefix from a scope identifier, leaving the bare scope name.
 * `api://<guid>/access_as_user` → `access_as_user`; `https://graph.microsoft.com/User.Read` →
 * `User.Read`; bare OIDC scopes (`openid`) pass through unchanged.
 */
export function stripScopePrefix(scope: string): string {
  const schemeIdx = scope.indexOf('://');
  if (schemeIdx === -1) return scope;
  const slashIdx = scope.lastIndexOf('/');
  if (slashIdx > schemeIdx + 2) return scope.slice(slashIdx + 1);
  return scope;
}

/** Granted scope **names** (resource prefixes stripped, empties dropped), order-preserving. */
export function scopeNames(scopes: readonly string[]): string[] {
  return scopes.map(stripScopePrefix).filter((s) => s.length > 0);
}

/** Space-delimited granted scope string for the token-response `scope` field (includes OIDC). */
export function scopeString(scopes: readonly string[]): string {
  return scopeNames(scopes).join(' ');
}

/** Space-delimited access-token `scp` value: granted scope names minus grant-only scopes. */
function scpValue(scopes: readonly string[]): string {
  return scopeNames(scopes)
    .filter((s) => !NON_RESOURCE_SCOPES.has(s))
    .join(' ');
}

/**
 * Resolve the access-token `aud` per the spec audience rule:
 * - no resource (OIDC-only) → the configured Graph resource id (so post-sign-in `/me` works);
 * - the Graph resource (id or a `https://graph.microsoft.com/...` scope) → the Graph resource id;
 * - an `api://` app-id-uri or a resource appId → that resource app's `appId` GUID;
 * - otherwise the literal resource identifier.
 */
export function resolveAudience(
  resource: string | null | undefined,
  config: Config,
  store: Store,
): string {
  if (!resource) return config.graphResourceId;
  if (resource === config.graphResourceId || resource.startsWith(`${config.graphResourceId}/`)) {
    return config.graphResourceId;
  }
  const byUri = store.apps.getByAppIdUri(resource);
  if (byUri) return byUri.appId;
  const byId = store.apps.getByAppId(resource);
  if (byId) return byId.appId;
  return resource;
}

export interface IdTokenClaimsParams {
  user: User;
  app: AppRegistration;
  tenantId: string;
  issuer: string;
  scopes: readonly string[];
  nonce?: string | null;
  now: number;
  lifetimeSeconds: number;
}

/** Assemble the ID-token claim set (spec #5 ID-token table). */
export function buildIdTokenClaims(params: IdTokenClaimsParams): IdTokenClaims {
  const { user, app, tenantId, issuer, scopes, nonce, now, lifetimeSeconds } = params;
  const claims: IdTokenClaims = {
    iss: issuer,
    sub: pairwiseSub(user.id, app.appId, tenantId),
    aud: app.appId,
    exp: now + lifetimeSeconds,
    iat: now,
    nbf: now,
    tid: tenantId,
    oid: user.id,
    name: user.displayName,
    preferred_username: user.userPrincipalName,
    ver: TOKEN_VERSION,
  };
  // `email` is included when the user has a mail value and the `email` scope was granted.
  if (user.mail != null && scopeNames(scopes).includes('email')) {
    claims.email = user.mail;
  }
  if (nonce != null) claims.nonce = nonce;
  return claims;
}

export interface DelegatedAccessClaimsParams {
  user: User;
  app: AppRegistration;
  tenantId: string;
  issuer: string;
  audience: string;
  scopes: readonly string[];
  now: number;
  lifetimeSeconds: number;
}

/** Assemble a delegated (user) access-token claim set: `oid`/`scp`, no `roles`. */
export function buildDelegatedAccessClaims(params: DelegatedAccessClaimsParams): AccessTokenClaims {
  const { user, app, tenantId, issuer, audience, scopes, now, lifetimeSeconds } = params;
  return {
    iss: issuer,
    sub: pairwiseSub(user.id, app.appId, tenantId),
    aud: audience,
    exp: now + lifetimeSeconds,
    iat: now,
    nbf: now,
    tid: tenantId,
    oid: user.id,
    azp: app.appId,
    appid: app.appId,
    scp: scpValue(scopes),
    ver: TOKEN_VERSION,
  };
}

export interface AppOnlyAccessClaimsParams {
  app: AppRegistration;
  tenantId: string;
  issuer: string;
  audience: string;
  roles: readonly string[];
  now: number;
  lifetimeSeconds: number;
}

/** Assemble an app-only (client-credentials) access-token claim set: `roles`, no `oid`/`scp`. */
export function buildAppOnlyAccessClaims(params: AppOnlyAccessClaimsParams): AccessTokenClaims {
  const { app, tenantId, issuer, audience, roles, now, lifetimeSeconds } = params;
  return {
    iss: issuer,
    sub: app.appId,
    aud: audience,
    exp: now + lifetimeSeconds,
    iat: now,
    nbf: now,
    tid: tenantId,
    azp: app.appId,
    appid: app.appId,
    roles: [...roles],
    ver: TOKEN_VERSION,
  };
}
