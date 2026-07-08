import type { Config } from '../config/schema.js';
import { graphPublicUrl } from '../http/pathmap.js';
import type { Store } from '../store/store.js';
import type { AppRegistration, OptionalClaim, OptionalClaimsConfig, User } from '../store/types.js';

/**
 * Resolution of configurable optional claims and group (membership) claims for locally issued
 * ID and access tokens (Entra token-configuration parity). This module is the single source of
 * truth for *which* optional claims Entra Local supports and *how* their values are sourced from
 * local directory data; `response.ts` (issuance) and the admin token-preview endpoint both consume
 * it so a preview provably matches the issued token.
 *
 * Design rules (from the feature spec):
 * - ID-token claims come from the **client** app's `optionalClaims.idToken`.
 * - Access-token claims come from the **resource/API** app's `optionalClaims.accessToken`.
 * - Unsupported optional claims are preserved in configuration but never emitted (and are surfaced
 *   to the caller so a warning can be logged).
 * - `groups` is emitted only when group claims are enabled; when the membership count exceeds the
 *   configured overage limit an Entra-style overage payload replaces the array.
 */

/** Which token collection an optional-claim set applies to (SAML is intentionally out of scope). */
export type OptionalClaimKind = 'idToken' | 'accessToken';

/** Supported optional claims for ID tokens (spec #2 minimum set). */
export const SUPPORTED_ID_TOKEN_CLAIMS: readonly string[] = [
  'email',
  'upn',
  'given_name',
  'family_name',
  'preferred_username',
  'auth_time',
  'ipaddr',
  'groups',
] as const;

/** Supported optional claims for access tokens (spec #2 minimum set; no `auth_time`). */
export const SUPPORTED_ACCESS_TOKEN_CLAIMS: readonly string[] = [
  'email',
  'upn',
  'given_name',
  'family_name',
  'preferred_username',
  'ipaddr',
  'groups',
] as const;

/** Deterministic local IP used for the `ipaddr` claim when no request address is available. */
export const LOCAL_IP_ADDRESS = '127.0.0.1';

/** The set of supported optional-claim names for the given token collection. */
export function supportedClaimNames(kind: OptionalClaimKind): readonly string[] {
  return kind === 'idToken' ? SUPPORTED_ID_TOKEN_CLAIMS : SUPPORTED_ACCESS_TOKEN_CLAIMS;
}

/** Whether `name` is a supported optional claim for the given token collection. */
export function isSupportedOptionalClaim(kind: OptionalClaimKind, name: string): boolean {
  return supportedClaimNames(kind).includes(name);
}

/** Per-request context used to source optional-claim values from local directory data. */
export interface ClaimResolutionContext {
  user: User;
  /** Token issue time (epoch seconds); default value for `auth_time`. */
  now: number;
  /** Authentication/session time (epoch seconds); falls back to `now`. */
  authTime?: number;
  /** Request IP address; falls back to {@link LOCAL_IP_ADDRESS}. */
  ipAddress?: string;
}

/**
 * Resolve a single (non-group) optional-claim value from local directory data. Returns `undefined`
 * when the value is unavailable so the caller can omit the claim (claims never carry empty values).
 */
function resolveClaimValue(name: string, ctx: ClaimResolutionContext): unknown {
  const { user } = ctx;
  switch (name) {
    case 'email':
      return user.mail ?? undefined;
    case 'upn':
      return user.userPrincipalName ?? user.mail ?? undefined;
    case 'given_name':
      return user.givenName ?? undefined;
    case 'family_name':
      return user.surname ?? undefined;
    case 'preferred_username':
      return user.userPrincipalName ?? user.mail ?? undefined;
    case 'auth_time':
      return ctx.authTime ?? ctx.now;
    case 'ipaddr':
      return ctx.ipAddress ?? LOCAL_IP_ADDRESS;
    default:
      return undefined;
  }
}

/** Whether the given optional-claims collection lists a claim named `name`. */
function hasOptionalClaim(entries: readonly OptionalClaim[], name: string): boolean {
  return entries.some((c) => c.name === name);
}

/** Result of resolving optional claims: emitted claims plus any unsupported names encountered. */
export interface OptionalClaimsResult {
  claims: Record<string, unknown>;
  /** Configured optional-claim names that Entra Local does not support (preserved, not emitted). */
  unsupported: string[];
}

/**
 * Resolve the supported optional claims for one token collection. The `groups` claim is skipped
 * here — it is produced by {@link resolveGroupClaims} so the overage rule can be applied uniformly.
 */
export function resolveOptionalClaims(
  kind: OptionalClaimKind,
  optionalClaims: OptionalClaimsConfig,
  ctx: ClaimResolutionContext,
): OptionalClaimsResult {
  const entries = optionalClaims[kind] ?? [];
  const claims: Record<string, unknown> = {};
  const unsupported: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'groups') continue;
    if (!isSupportedOptionalClaim(kind, entry.name)) {
      unsupported.push(entry.name);
      continue;
    }
    const value = resolveClaimValue(entry.name, ctx);
    if (value !== undefined) claims[entry.name] = value;
  }
  return { claims, unsupported };
}

/**
 * Whether group claims should be emitted for the given token collection: either the app's
 * `groupMembershipClaims` mode is not `None`, or `groups` is listed as an optional claim.
 */
export function groupClaimsEnabled(app: AppRegistration, kind: OptionalClaimKind): boolean {
  return (
    app.groupMembershipClaims !== 'None' || hasOptionalClaim(app.optionalClaims[kind], 'groups')
  );
}

/** The advertised local Graph endpoint used to resolve group membership on overage. */
export function groupOverageEndpoint(config: Config): string {
  return graphPublicUrl(config, '/graph/v1.0/me/memberOf');
}

/** Result of resolving group claims: emitted claims plus whether the overage payload was used. */
export interface GroupClaimsResult {
  claims: Record<string, unknown>;
  overage: boolean;
}

/**
 * Resolve the `groups` claim (stable local group IDs) for a user, or an Entra-style overage payload
 * (`_claim_names`/`_claim_sources`) when the membership count exceeds the configured limit. Returns
 * no claims when group claims are disabled for this app/collection.
 */
export function resolveGroupClaims(
  app: AppRegistration,
  kind: OptionalClaimKind,
  user: User,
  store: Store,
  config: Config,
): GroupClaimsResult {
  if (!groupClaimsEnabled(app, kind)) return { claims: {}, overage: false };
  const groupIds = store.groups.listGroupsForUser(user.id).map((g) => g.id);
  const limit = app.groupOverageLimit ?? config.groupOverageLimit;
  if (groupIds.length > limit) {
    return {
      claims: {
        _claim_names: { groups: 'src1' },
        _claim_sources: { src1: { endpoint: groupOverageEndpoint(config) } },
      },
      overage: true,
    };
  }
  return { claims: { groups: groupIds }, overage: false };
}

/** Parameters for {@link resolveAppTokenClaims}. */
export interface ResolveAppTokenClaimsParams {
  /** The app whose token configuration drives the claims (client app for ID, resource for access). */
  app: AppRegistration;
  kind: OptionalClaimKind;
  user: User;
  store: Store;
  config: Config;
  now: number;
  authTime?: number;
  ipAddress?: string;
}

/** Combined optional + group claim resolution for one token collection. */
export interface ResolveAppTokenClaimsResult {
  /** Extra claims to merge into the token payload (may include the overage claim payload). */
  claims: Record<string, unknown>;
  /** Unsupported optional-claim names that were configured but not emitted. */
  unsupportedClaims: string[];
  /** Whether the group overage payload was emitted instead of a `groups` array. */
  groupOverage: boolean;
}

/**
 * Resolve every configured optional + group claim for one token collection, applying the supported
 * set, value sourcing, and group overage rules. Used by both token issuance and the admin preview.
 */
export function resolveAppTokenClaims(
  params: ResolveAppTokenClaimsParams,
): ResolveAppTokenClaimsResult {
  const { app, kind, user, store, config, now, authTime, ipAddress } = params;
  const optional = resolveOptionalClaims(kind, app.optionalClaims, {
    user,
    now,
    authTime,
    ipAddress,
  });
  const group = resolveGroupClaims(app, kind, user, store, config);
  return {
    claims: { ...optional.claims, ...group.claims },
    unsupportedClaims: optional.unsupported,
    groupOverage: group.overage,
  };
}
