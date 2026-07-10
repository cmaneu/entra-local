# Token configuration — optional claims & group claims

Entra Local emulates Microsoft Entra ID's **token configuration**: the ability to add **optional
claims** to issued tokens and to emit **group membership claims**. This lets MSAL-based apps test
realistic authorization flows locally — including the **group overage** behaviour — without a cloud
tenant.

This document covers what is supported, how ID-token vs access-token configuration differ, the
group overage payload, the seeded demo apps, and the exact portal steps.

> Scope: this feature implements **optional claims** and **group claims** only. Claims-mapping
> policies, custom claims providers, SAML tokens, and app roles are out of scope.

---

## ID token vs access token — who owns the configuration

This is the single most important concept, and it mirrors Microsoft Entra ID:

| Token          | Configuration comes from…                     | Why |
| -------------- | --------------------------------------------- | --- |
| **ID token**   | the **client** app registration               | The ID token describes the user to the app that signed them in. |
| **Access token** | the **resource / API** app registration      | The access token is consumed by the API, so the API decides what it needs. Entra Local resolves the resource app from the requested `api://…` scope (the token's `aud`) and applies **that** app's access-token configuration — never the calling client's. |

The portal **Token configuration** card and the token-preview endpoint both make this explicit.

---

## Supported optional claims

Unsupported optional claims are **preserved** in the app configuration (so nothing is lost) but are
**never emitted**, and the token endpoint logs a warning. The portal flags them as `unsupported`.

**ID token**

```
email  upn  given_name  family_name  preferred_username  auth_time  ipaddr  groups
```

**Access token**

```
email  upn  given_name  family_name  preferred_username  ipaddr  groups
```

Claim value sources:

| Claim                | Source |
| -------------------- | ------ |
| `email`              | Local user email (`mail`) |
| `upn`                | Local user `userPrincipalName`, falling back to email |
| `given_name`         | Local user given name |
| `family_name`        | Local user surname |
| `preferred_username` | Local user UPN, falling back to email |
| `auth_time`          | Authentication/session timestamp (ID token only) |
| `ipaddr`             | Request IP address, or the deterministic local value `127.0.0.1` |
| `groups`             | Local group memberships, when group claims are enabled |

Claims are only emitted when a value is available (no empty claims).

---

## Group claims

Set the app's **group claims** mode to emit the user's memberships. Supported values:

```
None  SecurityGroup  DirectoryRole  ApplicationGroup  All
```

`SecurityGroup` and `All` currently behave the same (Entra Local does not yet distinguish group
types), but the explicit values are preserved so configuration is forward-compatible.

When enabled, `groups` is emitted as an array of **stable local group IDs** (not display names):

```json
{
  "groups": ["bbbbbbbb-0000-0000-0000-000000000001", "bbbbbbbb-0000-0000-0000-000000000002"]
}
```

Group display names are resolved separately via the local Graph endpoints (below).

### Group overage

Entra ID caps how many groups it will inline in a JWT; beyond that it emits an **overage** pointer
instead of the array, and the app must call Microsoft Graph to get the full list. Entra Local
reproduces this.

The limit is per-app (`groupOverageLimit`), falling back to the server default (`200`, configurable
via `GROUP_OVERAGE_LIMIT`). When a user's membership **exceeds** the limit, the token carries:

```json
{
  "_claim_names": { "groups": "src1" },
  "_claim_sources": {
    "src1": { "endpoint": "https://localhost:8443/graph/v1.0/me/memberOf" }
  }
}
```

The app resolves the full membership by calling that endpoint (see **Graph endpoints**). The seeded
demo apps set `groupOverageLimit` to **3** so a 4-group user triggers overage without you having to
create hundreds of groups.

---

## Graph endpoints for group resolution

The local Graph endpoint supports enough for the overage flow:

```http
GET /graph/v1.0/me
GET /graph/v1.0/users/{id}
GET /graph/v1.0/me/memberOf
GET /graph/v1.0/users/{id}/memberOf
GET /graph/v1.0/groups
GET /graph/v1.0/groups/{id}
GET /graph/v1.0/groups/{id}/members
```

`memberOf` returns a collection of the user's groups:

```json
{
  "value": [
    { "id": "bbbbbbbb-0000-0000-0000-000000000002", "displayName": "Developers", "description": "Local developers group" }
  ]
}
```

---

## Seeded demo apps and users

Seeded into the emulator (see [`src/store/seed.ts`](../src/store/seed.ts)) with fixed GUIDs:

| App              | `appId`                                 | Token config |
| ---------------- | --------------------------------------- | ------------ |
| `local-web-client` | `cccccccc-0000-0000-0000-000000000006`  | **ID token** optional claims: `email`, `upn`, `given_name`, `family_name`, `groups`; group claims `SecurityGroup`; overage limit `3`. Redirect URI `http://localhost:3000`. |
| `local-api`        | `cccccccc-0000-0000-0000-000000000007`  | **Access token** optional claims: `email`, `upn`, `groups`; group claims `SecurityGroup`; overage limit `3`. Exposes scope `access_as_user`. |

Seeded users (dev-only credentials, password `Password1!`):

| User                    | Groups                                             | Group claim result |
| ----------------------- | -------------------------------------------------- | ------------------ |
| `alice@entralocal.dev`  | Engineering, Developers, Data Team, Local Admins (4) | **overage** (> limit 3) — token carries `_claim_names`/`_claim_sources` |
| `bob@entralocal.dev`    | Engineering, Developers (2)                          | inline `groups` array |

---

## Expected decoded tokens

**ID token** from `local-web-client` for **Bob** (under the overage limit):

```json
{
  "aud": "cccccccc-0000-0000-0000-000000000006",
  "iss": "https://localhost:8443/11111111-1111-1111-1111-111111111111/v2.0",
  "tid": "11111111-1111-1111-1111-111111111111",
  "name": "Bob Example",
  "preferred_username": "bob@entralocal.dev",
  "email": "bob@entralocal.dev",
  "upn": "bob@entralocal.dev",
  "given_name": "Bob",
  "family_name": "Example",
  "groups": ["bbbbbbbb-0000-0000-0000-000000000001", "bbbbbbbb-0000-0000-0000-000000000002"]
}
```

**Access token** from `local-api` (audience = the API), acquired by `local-web-client` for **Alice**
(over the overage limit):

```json
{
  "aud": "cccccccc-0000-0000-0000-000000000007",
  "iss": "https://localhost:8443/11111111-1111-1111-1111-111111111111/v2.0",
  "tid": "11111111-1111-1111-1111-111111111111",
  "scp": "access_as_user",
  "azp": "cccccccc-0000-0000-0000-000000000006",
  "email": "alice@entralocal.dev",
  "upn": "alice@entralocal.dev",
  "_claim_names": { "groups": "src1" },
  "_claim_sources": { "src1": { "endpoint": "https://localhost:8443/graph/v1.0/me/memberOf" } }
}
```

Note the access token's claims (`email`, `upn`, groups) come from **`local-api`**, not from the
`local-web-client` that requested it.

---

## Configuring from the portal

1. Open the **Entra Local portal**.
2. Go to **App registrations** and select an app (e.g. `local-web-client`).
3. Scroll to **Token configuration**.
4. Under **ID token — optional claims**, add supported claims (e.g. `email`, `upn`, `groups`).
   Add **access token** claims on the **resource/API** app (e.g. `local-api`) instead.
5. Set **Group claims** (e.g. *Security groups*) and, optionally, a **Group overage limit**.
6. Click **Save**.
7. Use **Token preview**: pick a **user** and **token type**, then **Preview** to see the exact
   decoded claim payload (including overage) the app would issue.
8. Sign in again from your app and decode the issued token — it will match the preview.

---

## Admin API

The same configuration is available over the Admin REST API (`/admin/api`):

- `GET  /admin/api/token-configuration/supported-claims` — supported claims + group modes + default overage limit.
- `PATCH /admin/api/apps/{id}` — set `optionalClaims`, `groupMembershipClaims`, `groupOverageLimit`.
- `POST /admin/api/apps/{id}/token-preview` — body `{ "userId": "...", "tokenType": "idToken" | "accessToken" }`.
- `POST /admin/api/apps/{id}/token-generate` — the same body; returns a signed local-development token and its decoded claims.
