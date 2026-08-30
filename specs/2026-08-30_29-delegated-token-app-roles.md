# Issue #29 — Emit `roles` in Delegated (User) Access Tokens

- **Issue:** Not yet filed; implementation proceeding ahead of issue acceptance at the requester's
  direction. To be reconciled with an accepted issue before merge.
- **Roadmap ref:** Compatibility follow-up to Iteration 1 feature #5 (Token Service) and feature #8
  (Client Credentials), which introduced the `roles` claim and its app-role auto-grant model for
  app-only tokens only.
- **Dependencies:** [#5](2026-06-22_05-token-service.md) (token service / claim assembly),
  [#8](2026-06-22_08-client-credentials.md) (app-role auto-grant model), [#6](2026-06-22_06-auth-code-pkce-signin.md)
  (delegated auth-code issuance).
- **Status:** ⬜ Not started.

---

## Goal / outcome

Resource APIs that derive Spring Security / authorization-framework authorities exclusively from a
JWT `roles` claim currently receive **no `roles` claim at all** in delegated (user) access tokens
minted by Entra Local, because `roles` is only emitted for app-only (client-credentials) tokens
today. This makes every delegated call to such an API fail authorization, even though the token is
otherwise valid (signature, `iss`, `aud`, `scp` all correct).

Mirror the existing app-only auto-grant shortcut for delegated tokens: a delegated access token's
`roles` claim becomes the `value`s of all **enabled** app roles on the **resolved resource app**
(the API being called) whose `allowedMemberTypes` includes `User`. This is the documented MVP
divergence from real Entra ID (no per-user app-role assignment store), analogous to the existing
app-only auto-grant and the project's auto-consent decision.

---

## Scope

### In scope

- Emit a `roles` claim on delegated access tokens (Authorization Code + PKCE, and Refresh Token,
  since both flow through the shared token-response builder), computed the same way as today's
  app-only auto-grant but filtered by `allowedMemberTypes` including `User` instead of
  `Application`.
- Resolve the resource app the same way access-token optional/group claims already do: the
  registered app whose `appId` equals the resolved access-token `aud`. No resource app (Graph, or
  an unregistered resource) → `roles: []`, matching today's app-only Graph behavior.
- Extract the existing `Application`-typed role filter in
  `src/identity/clientCredentials.ts` into a shared, member-type-parameterized helper so both
  flows use one implementation.
- Add unit coverage for the shared helper's `User` filtering and integration coverage that a
  delegated access token minted via Authorization Code + PKCE carries the expected `roles`.
- Document the new claim behavior in `docs/token-configuration.md` (or the nearest existing claims
  reference) and append a `memory/decisions.md` entry recording the divergence.

### Out of scope

- Per-user app-role assignment (a real assignment table, admin API, or portal UI to assign
  specific roles to specific users). Every local user continues to receive every enabled
  `User`-typed role on the resource app — this is the accepted MVP trade-off, not a partial step
  toward per-user assignment.
- Any change to app-only (client-credentials) `roles` behavior, which is unchanged.
- Any change to `scp`, `oid`, group claims, or other delegated-token claims.
- Device Code flow changes beyond what the shared token-response builder already provides (no
  separate work needed; it reuses the same builder).
- Consent modeling, Graph app-role writes, or directory-object changes (all deferred per the
  roadmap).

---

## Contract

### Claim shape

Delegated access tokens gain an optional `roles` array, using the existing
`AccessTokenClaims.roles?: string[]` field (already declared for app-only tokens):

```jsonc
{
  "iss": "...",
  "sub": "...",
  "aud": "<resolved resource app id or Graph resource id>",
  "oid": "<user id>",
  "scp": "access_as_user",
  "roles": ["ROLE_ADMIN", "ROLE_USER"], // new: enabled User-typed app roles on the resource app
  "azp": "<client app id>",
  "appid": "<client app id>",
  "ver": "2.0"
}
```

- When the resolved audience has no registered resource app (Graph, or an unresolved custom
  resource), `roles` is `[]` — matching today's app-only Graph behavior exactly.
- When the resource app has no enabled `User`-typed roles, `roles` is `[]`.
- `roles` is always present as an array (never omitted), matching the existing app-only behavior
  (`payload.roles` is asserted `toEqual([])` for Graph today).

### Auto-grant rule

Identical mechanics to the app-only auto-grant (`autoGrantedRoles` in
`src/identity/clientCredentials.ts`), generalized by member type:

> The `roles` claim is the `value`s of all **enabled** `app_roles` on the resolved resource app
> whose `allowed_member_types` (comma-separated) includes the flow's member type — `Application`
> for client credentials, `User` for delegated flows.

No per-user filtering: every signed-in user receives every matching role on the resource app.

---

## Implementation approach

### Shared helper

Add `src/identity/appRoles.ts` exporting:

```ts
export type AppRoleMemberType = 'Application' | 'User';

export function rolesForMemberType(
  resourceApp: AppRegistration | null,
  store: Store,
  memberType: AppRoleMemberType,
): string[];
```

containing the filter logic currently inlined in `autoGrantedRoles`. Update
`src/identity/clientCredentials.ts`'s `autoGrantedRoles(resourceApp, store)` to delegate to
`rolesForMemberType(resourceApp, store, 'Application')`, keeping its existing signature and call
site in `src/identity/token.ts` unchanged.

### Claim assembly

- `src/tokens/claims.ts`: add `roles?: readonly string[]` to `DelegatedAccessClaimsParams`; in
  `buildDelegatedAccessClaims`, set `roles: [...(params.roles ?? [])]` on the returned claims
  (always an array, mirroring `buildAppOnlyAccessClaims`).
- `src/tokens/response.ts`: in `buildTokenResponse`, the delegated branch already resolves
  `const resourceApp = store.apps.getByAppId(audience)` for optional/group-claim resolution. Reuse
  that lookup to compute `rolesForMemberType(resourceApp, store, 'User')` and pass it as `roles`
  into `buildDelegatedAccessClaims`. No new store lookups.

### Tests

1. Unit: `rolesForMemberType` — null resource app → `[]`; filters disabled roles; filters roles
   whose `allowedMemberTypes` excludes `User`; includes roles with a comma list containing `User`.
   Keep the existing `autoGrantedRoles` unit tests passing unchanged (regression for the
   `Application` path after the refactor).
2. Integration: an Authorization Code + PKCE sign-in against a seeded app with an enabled
   `User`-typed role asserts the decoded access token's `roles` contains that role's value; a
   sign-in where the resource is Graph (or an app with no matching roles) asserts `roles: []`.
3. Refresh Token: a rotated refresh-token response for the same app/user still carries the
   expected `roles` (proves the shared builder path, no flow-specific duplication).

---

## Testable acceptance criteria

1. A delegated access token for a resource app with an enabled `User`-typed role includes that
   role's `value` in `roles`.
2. A delegated access token for the Graph resource, or an app with no matching enabled `User`-typed
   roles, has `roles: []`.
3. Disabled roles and roles whose `allowedMemberTypes` excludes `User` never appear.
4. App-only (client-credentials) `roles` behavior is unchanged (existing tests remain green
   unmodified).
5. Refresh-token-issued access tokens carry the same `roles` as the original delegated token for
   unchanged scope/resource.
6. `docs/token-configuration.md` documents the new claim and the no-per-user-assignment
   divergence; `memory/decisions.md` has a new entry recording the decision.
7. `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, and `npm run test:e2e` are
   green.

---

## Decisions / assumptions

- No per-user app-role assignment table is introduced. Every local user receives every enabled
  `User`-typed role on the resource app — a deliberate MVP divergence from real Entra ID, consistent
  with the existing app-only auto-grant and the project's auto-consent shortcut.
- The shared `rolesForMemberType` helper lives under `src/identity/` (not `src/tokens/`) because
  `src/tokens/service.ts` already imports from `src/identity/` (`buildIssuer`), so this direction of
  dependency is an established pattern in this codebase.
- This spec proceeds without a pre-existing accepted GitHub issue, at the requester's explicit
  direction; `CONTRIBUTING.md`'s normal "open an issue before you open a pull request" gate still
  applies before this branch is merged and must be reconciled (an issue opened/linked) prior to
  merge.
