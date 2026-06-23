/**
 * Canonical single-origin path map constants.
 *
 * Single source of truth for reserved API prefixes and the tenant sub-prefixes used to
 * distinguish API routes from SPA routes. See the path-map table in
 * specs/2026-06-22_01-server-config-tls-foundation.md.
 */

/** Static reserved API prefixes (everything else falls through to the SPA). */
export const RESERVED_PREFIXES = ['/health', '/graph', '/admin'] as const;

/** Literal tenant aliases accepted in addition to the configured tenant GUID. */
export const TENANT_ALIASES = ['common', 'organizations', 'consumers'] as const;

/**
 * Canonical tenanted endpoint path suffixes (the part after `/{tenant}/`). Single source of
 * truth shared by route registration (`/:tenant/${suffix}`) and the OIDC discovery document's
 * advertised endpoint URLs (`${PUBLIC_ORIGIN}/${tenantId}/${suffix}`), so every advertised URL
 * provably maps to a registered route (a `501` stub or real handler per the Reserved-stub rule).
 */
export const TENANT_ENDPOINTS = {
  discovery: 'v2.0/.well-known/openid-configuration',
  authorize: 'oauth2/v2.0/authorize',
  token: 'oauth2/v2.0/token',
  jwks: 'discovery/v2.0/keys',
  logout: 'oauth2/v2.0/logout',
  devicecode: 'oauth2/v2.0/devicecode',
} as const;

/**
 * Canonical single-origin UserInfo path (under `/graph`, not `/{tenant}/...`). Locked path map
 * overrides the draft global-spec `/{tenant}/openid/userinfo`. Advertised by discovery (#4),
 * implemented by #9.
 */
export const USERINFO_PATH = '/graph/oidc/userinfo';

/** Build a registered tenanted route template (`/:tenant/${suffix}`) for Fastify registration. */
export function tenantRoute(suffix: string): string {
  return `/:tenant/${suffix}`;
}

/**
 * Second path segment values that mark a `/{tenant}/...` route as API (not SPA). Used so an
 * unmatched tenant-shaped GET returns a JSON 404 instead of the SPA placeholder.
 */
export const TENANT_API_SEGMENTS = ['v2.0', 'discovery', 'oauth2', 'openid'] as const;

/** Strip the query string from a raw request URL. */
function pathOnly(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Whether a URL targets a reserved API surface (vs. the SPA). Drives the SPA-fallback guard:
 * reserved API paths that don't match a route must return JSON 404, never the SPA HTML.
 */
export function isReservedApiPath(url: string): boolean {
  const path = pathOnly(url);

  if (path === '/health') return true;
  for (const prefix of ['/graph', '/admin'] as const) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return true;
  }

  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length >= 2 && (TENANT_API_SEGMENTS as readonly string[]).includes(segments[1]!)) {
    return true;
  }

  return false;
}
