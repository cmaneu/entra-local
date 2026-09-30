# User app roles in ID tokens

Use direct app-role assignments to test web applications that authorize a signed-in
user from their ID token. Declaring a role alone does not grant it to anyone.

For an app ID `CLIENT_ID` and a user ID `USER_ID` (available from the admin portal or
`GET /admin/api/apps` and `GET /admin/api/users`), create a user role:

```http
POST /admin/api/apps/CLIENT_ID/roles
Content-Type: application/json

{"value":"console.operator","displayName":"Operator","allowedMemberTypes":["User"]}
```

Copy the returned role `id` as `ROLE_ID`, then assign it:

```http
POST /admin/api/apps/CLIENT_ID/roleAssignments
Content-Type: application/json

{"roleId":"ROLE_ID","userId":"USER_ID"}
```

The assignment request returns 204. Repeating it is safe. Sign in as that user to
that client with `openid` in the requested scopes: the ID token will contain
`"roles":["console.operator"]`. An unassigned user can still sign in, but their ID
token omits `roles`. The application decides whether to allow that user access.
The admin token preview and token generator use the same assignments.

List assignments using `GET /admin/api/apps/CLIENT_ID/roleAssignments?top=50&skip=0`.
The response contains `value` (objects with `roleId` and `userId`), `count`, `top`,
and `skip`. Remove an assignment with:

```http
DELETE /admin/api/apps/CLIENT_ID/roleAssignments/ROLE_ID/USER_ID
```

Deletion returns 204 even when already absent. Sign in again or refresh the token
to observe removal. Already-issued tokens retain their claims until expiry.
Disabling a role prevents **new** assignments but preserves existing grants,
[matching Entra behavior](https://learn.microsoft.com/entra/identity-platform/howto-add-app-roles-in-apps).
Delete the assignment to revoke that grant. Role values are sorted in emitted tokens.

Assignments survive emulator restarts; deleting the user, role, or app cascades to
its assignments. Reset clears them. Only roles that allow `User` can receive new
user assignments, and the user must belong to the app's tenant.

This small model uses app registrations directly. It does not model enterprise
service principals, group-based role assignments, Graph assignment endpoints,
assignment-required sign-in, or a portal assignment editor. Assignments affect
**ID tokens for that client app**; access-token behavior is unchanged.
