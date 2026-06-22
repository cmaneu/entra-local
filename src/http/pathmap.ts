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
