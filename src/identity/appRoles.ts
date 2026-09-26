import type { Store } from '../store/store.js';
import type { AppRegistration } from '../store/types.js';

/**
 * Shared app-role auto-grant filter for both client-credentials (`Application`) and delegated
 * (`User`) flows. See `clientCredentials.ts`'s `autoGrantedRoles` and `tokens/response.ts`'s
 * delegated `roles` assembly for the two call sites.
 */
export type AppRoleMemberType = 'Application' | 'User';

/**
 * Auto-grant model (MVP): the `value`s of all **enabled** app roles on `resourceApp` whose
 * `allowedMemberTypes` (comma-separated) includes `memberType`. No resource app, or no matching
 * roles, → `[]`. There is no per-client/per-user assignment table (documented divergence from
 * real Entra, analogous to the auto-consent decision).
 */
export function rolesForMemberType(
  resourceApp: AppRegistration | null,
  store: Store,
  memberType: AppRoleMemberType,
): string[] {
  if (!resourceApp) return [];
  return store.apps
    .listRoles(resourceApp.appId)
    .filter(
      (role) =>
        role.isEnabled &&
        role.allowedMemberTypes
          .split(',')
          .map((t) => t.trim())
          .includes(memberType),
    )
    .map((role) => role.value);
}
