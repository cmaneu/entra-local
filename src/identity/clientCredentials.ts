import type { Config } from '../config/schema.js';
import type { Store } from '../store/store.js';
import type { AppRegistration } from '../store/types.js';

/**
 * `.default`-scope resolution and the app-role auto-grant model for the client-credentials grant
 * (feature #8). This module is the single source of truth for turning a `<resource>/.default`
 * scope into the token `aud` + resolved resource app, and for deriving the auto-granted `roles`
 * claim. The grant handler in `token.ts` composes these with the shared `authenticateClient`
 * helper and the #5 token-response builder.
 */

const DEFAULT_SUFFIX = '/.default';

/** A successfully resolved `.default` resource: the token `aud` and the resource app (if any). */
export interface ResolvedResource {
  /** The access-token `aud` (verbatim resource per #8's resolution order). */
  aud: string;
  /** The registered resource app the token targets, or `null` for Graph. */
  resourceApp: AppRegistration | null;
}

/** Resolution outcome: success, or a canonical OAuth error to surface. */
export type ResolveResult =
  | { ok: true; resolved: ResolvedResource }
  | { ok: false; error: 'invalid_request' | 'invalid_scope'; description: string };

/**
 * Resolve a client-credentials `scope` to a token `aud` + resource app per #8's resolution order.
 *
 * The `scope` must be exactly one `<resource>/.default` value; mixing in OIDC scopes
 * (`openid`/`offline_access`) or any non-`.default` scope is rejected as `invalid_scope`. The
 * `<resource>` is matched against, in order: the configured Graph resource id (→ `aud` = Graph id,
 * no resource app); a registered app's `app_id_uri` (→ `aud` = that URI string); a registered app's
 * `app_id` GUID (→ `aud` = that GUID). An unresolvable resource is `invalid_scope`.
 */
export function resolveClientCredentialScope(
  rawScope: string | undefined,
  config: Config,
  store: Store,
): ResolveResult {
  const tokens = (rawScope ?? '').split(/\s+/).filter((s) => s.length > 0);
  if (tokens.length === 0) {
    return {
      ok: false,
      error: 'invalid_request',
      description: 'Missing required parameter: scope.',
    };
  }
  if (tokens.length > 1) {
    return {
      ok: false,
      error: 'invalid_scope',
      description:
        'Client credentials requires exactly one <resource>/.default scope; OIDC scopes ' +
        '(openid/offline_access) and additional scopes are not permitted.',
    };
  }

  const scope = tokens[0];
  if (scope === undefined || !scope.endsWith(DEFAULT_SUFFIX)) {
    return {
      ok: false,
      error: 'invalid_scope',
      description: `The scope '${scope}' is not a <resource>/.default scope.`,
    };
  }
  const resource = scope.slice(0, scope.length - DEFAULT_SUFFIX.length);

  // 1. Graph: aud = the configured Graph resource id; no registered resource app.
  if (resource === config.graphResourceId) {
    return { ok: true, resolved: { aud: config.graphResourceId, resourceApp: null } };
  }
  // 2. Registered app by app_id_uri: aud = the app_id_uri string verbatim.
  const byUri = store.apps.getByAppIdUri(resource);
  if (byUri) {
    return { ok: true, resolved: { aud: resource, resourceApp: byUri } };
  }
  // 3. Registered app by GUID app_id: aud = the app_id GUID verbatim.
  const byId = store.apps.getByAppId(resource);
  if (byId) {
    return { ok: true, resolved: { aud: resource, resourceApp: byId } };
  }
  // 4. Unresolvable.
  return {
    ok: false,
    error: 'invalid_scope',
    description: `The resource '${resource}' could not be resolved to a known API.`,
  };
}

/**
 * Auto-grant model (MVP): the `roles` claim is the `value`s of all **enabled** `app_roles` on the
 * resolved resource app whose `allowed_member_types` includes `Application`. Graph or no such roles
 * → empty array. There is no per-client assignment table (documented divergence from real Entra,
 * analogous to the auto-consent decision).
 */
export function autoGrantedRoles(resourceApp: AppRegistration | null, store: Store): string[] {
  if (!resourceApp) return [];
  return store.apps
    .listRoles(resourceApp.appId)
    .filter(
      (role) =>
        role.isEnabled &&
        role.allowedMemberTypes
          .split(',')
          .map((t) => t.trim())
          .includes('Application'),
    )
    .map((role) => role.value);
}
