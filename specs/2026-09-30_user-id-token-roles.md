# Direct user app-role assignments in ID tokens

Status: proposal for maintainer review; separate from #30 / #31, which cover
resource-app roles in delegated access tokens and explicitly exclude assignments.

## Scenario and scope

A web application authorizes staff from the signed ID token's `roles` claim. Local
tests must distinguish an assigned operator from an authenticated, unassigned user.
Automatically granting every declared role cannot exercise that boundary.

Support direct user assignments to existing client-app roles through the admin API,
persisted in SQLite. No seed changes, portal editor, group assignments, service
principals, Graph assignment API, or assignment-required sign-in policy. Access-token
behavior remains unchanged; this proposal does not replace #31.

## Contract

- `GET /admin/api/apps/:id/roleAssignments?top=50&skip=0`: paginated
  `{ value: [{ roleId, userId }], count, top, skip }` using the existing paging envelope.
- `POST /admin/api/apps/:id/roleAssignments`: `{ roleId, userId }`, returns 204.
  The role must belong to the app, allow `User`, and be enabled for a new assignment.
  The user must exist in the app's tenant. Repeating an existing assignment is a no-op.
- `DELETE /admin/api/apps/:id/roleAssignments/:roleId/:userId`: 204, idempotent.
- Missing parent apps return 404; invalid references return 400 `invalid_reference`;
  malformed input and ineligible roles return 400 `validation_error`.
- ID tokens contain sorted role **values** assigned to that user for that client app.
  Omit `roles` when there are no assignments. Roles are not optional claims.
- The shared claim resolver gives authorization-code/refresh/device-code issuance,
  admin preview, and generated tokens the same behavior.
- Disabling a role prevents new assignments but preserves existing assignments and
  their token claims. Remove an assignment to revoke its role in newly issued tokens.
  Previously issued tokens remain valid until expiry.

Microsoft documents this behavior in [Add app roles to your application and receive
them in the token](https://learn.microsoft.com/entra/identity-platform/howto-add-app-roles-in-apps).

## Persistence

Forward-only migration 003 adds `user_app_role_assignments(role_id, user_id)` with a
composite primary key and cascading foreign keys to roles and users. App ownership
comes from the role; no duplicated app ID. Reset clears assignments. Existing
installations and seeds gain no assignments automatically.

## Acceptance and replay

Integration tests drive the admin API, full authorization-code exchange, and refresh;
verify signed JWTs against the published JWKS; check isolation across users/clients,
preview parity, duplicate/removal behavior, disabled/application-only roles, bad
references, persistence across reopening, migration from version 2, and cascade/reset.

Replay with `bun run test -- test/integration/user-roles.test.ts` (Node 24).
Inputs use only the public Alice/Bob and SPA fixtures plus local role definitions.
Expected: Alice receives only explicitly assigned client-role values; Bob and another
client receive no roles; refresh after assignment removal omits the revoked value.
The test runner reports each observed outcome and exits nonzero on a mismatch.


The real MSAL browser sign-in test also verifies the assigned role in the signed ID
token. Replay with `bun run test:e2e -- test/e2e/auth-code.e2e.ts`; it writes inputs,
expected values, and observed values (without tokens) to
`data/.tmp/user-id-token-roles-replay.json`.
