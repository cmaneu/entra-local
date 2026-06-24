import type { Config } from '../config/schema.js';
import type { Store } from '../store/store.js';

/**
 * Scope/resource helpers shared by `/authorize` (#6) and the device-authorization endpoint + the
 * `device_code` grant (#15). Extracted verbatim from `authorize.ts` as a behavior-preserving move:
 * `/authorize` keeps its exact current (lenient) validation semantics and `/devicecode` inherits
 * them unchanged. OIDC scopes and Graph scopes always pass; bare (unqualified) scopes are accepted
 * leniently; a fully-qualified `api://...` scope must resolve to a registered, enabled scope on the
 * named resource app.
 */

/** OIDC/grant scopes that are not resource permissions. */
export const OIDC_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access']);

/** Split a scope string into its space-delimited parts (empties dropped). */
export function splitScopes(scope: string): string[] {
  return scope.split(/\s+/).filter((s) => s.length > 0);
}

/**
 * Resolve the resource identifier driving the audience rule from the requested scopes: the prefix
 * of the first fully-qualified resource scope (`api://<guid>/scope` → `api://<guid>`;
 * `https://graph.microsoft.com/.default` → `https://graph.microsoft.com`). OIDC-only requests
 * resolve to `null` (audience then falls back to the Graph resource per #5).
 */
export function resolveResource(scopes: readonly string[]): string | null {
  for (const s of scopes) {
    if (OIDC_SCOPES.has(s)) continue;
    const schemeIdx = s.indexOf('://');
    if (schemeIdx === -1) continue;
    const slash = s.lastIndexOf('/');
    return slash > schemeIdx + 2 ? s.slice(0, slash) : s;
  }
  return null;
}

/**
 * Whether every requested resource scope is registered/allowed. OIDC scopes and Graph scopes always
 * pass; bare (unqualified) scopes are accepted leniently; a fully-qualified `api://...` scope must
 * resolve to a registered, enabled scope on the named resource app — otherwise it is invalid.
 */
export function scopesAreValid(scopes: readonly string[], store: Store, config: Config): boolean {
  for (const s of scopes) {
    if (OIDC_SCOPES.has(s)) continue;
    const schemeIdx = s.indexOf('://');
    if (schemeIdx === -1) continue; // bare scope: lenient
    const slash = s.lastIndexOf('/');
    const prefix = slash > schemeIdx + 2 ? s.slice(0, slash) : s;
    const bare = slash > schemeIdx + 2 ? s.slice(slash + 1) : s;
    if (prefix === config.graphResourceId || prefix === 'https://graph.microsoft.com') continue;
    const app = store.apps.getByAppIdUri(prefix);
    if (!app) return false;
    if (bare === '.default') continue;
    const ok = store.apps.listScopes(app.appId).some((sc) => sc.value === bare && sc.isEnabled);
    if (!ok) return false;
  }
  return true;
}
