# Feature #15 — Device Code Flow (RFC 8628)

- **Roadmap ref:** Iteration 1, feature #15 ("Device Code flow — `/devicecode` + user-code approval page (RFC 8628) for CLI/device apps"). **UI:** ✓ (user-code approval page).
- **Dependencies:** [#5](2026-06-22_05-token-service.md) (mint + `buildTokenResponse`), [#6](2026-06-22_06-auth-code-pkce-signin.md) (canonical OAuth error convention, the `/token` route + `authenticateClient`, the sign-in/account-picker page, the `el_session` SSO cookie, the signed-state `__el_state` pattern). Transitively [#2](2026-06-22_02-sqlite-store-schema-seed.md) (the pre-existing `device_codes` table, apps/users/sessions repos), [#4](2026-06-22_04-oidc-discovery.md) (discovery doc / tenant aliasing).
- **Status:** ✅ Implemented & verified (lint/typecheck/build clean; 311 unit, 23 e2e).

> **Canonical-reference notice.** This spec owns the **RFC 8628 device-authorization + polling contract** and the **user-code approval surface**. It plugs the `device_code` grant into the `/token` dispatch table ([#6](2026-06-22_06-auth-code-pkce-signin.md)) and replaces the reserved `501` stub on `POST /{tenant}/oauth2/v2.0/devicecode`. It reuses #5's token-response builder and #6's sign-in/session machinery — no divergent token assembly or sign-in UI.

---

## Goal / outcome

A working RFC 8628 Device Authorization Grant: a CLI/device public client calls `POST /{tenant}/oauth2/v2.0/devicecode` to obtain a `device_code` + a short human-transcribable `user_code` + a `verification_uri`; a human opens that URI in a browser, signs in (reusing #6's account-picker / SSO session), and **approves** (or denies) the request for the named app + scopes; meanwhile the device polls `POST /{tenant}/oauth2/v2.0/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`, receiving `authorization_pending` until approval, then the full JWKS-verifiable token set (access + `id_token` when `openid` + `refresh_token` when `offline_access`) carrying the **approving user's** claims. This is exactly what `@azure/msal-node` `PublicClientApplication.acquireTokenByDeviceCode(...)` drives.

---

## Scope

### In scope
- `POST /{tenant}/oauth2/v2.0/devicecode` — RFC 8628 §3.1/§3.2 device authorization endpoint (JSON in/out). Replaces the `501` stub.
- `GET /{tenant}/oauth2/v2.0/devicecode` — the human **approval page** (code-entry → sign-in → approve/deny consent), server-rendered HTML reusing #6's sign-in UI + `el_session` SSO.
- `POST /{tenant}/oauth2/v2.0/devicecode/verify` — the approval-page form-submit target (lookup → sign-in → decide), distinct from the RFC POST above.
- `device_code` grant handler in the `/token` dispatch table (RFC 8628 §3.4/§3.5 polling semantics).
- A `deviceCodes` repository over the pre-existing `device_codes` table ([#2](2026-06-22_02-sqlite-store-schema-seed.md)); surfaced on `Store`.
- Discovery additions: `device_authorization_endpoint` + the `device_code` grant in `grant_types_supported` ([#4](2026-06-22_04-oidc-discovery.md) metadata), including a new field on the `DiscoveryMetadata` interface.
- Extending the canonical OAuth error module (`oauthErrors.ts`) with the three RFC 8628 polling error codes.
- Extracting the scope/resource helpers shared between `/authorize` and `/devicecode`.
- Single-use consumption of an approved device code; lazy expiry.

### Out of scope
- Polling-rate enforcement / `slow_down` emission (the emulator advertises `interval`; clients honor it — see Decisions). No `slow_down` is ever returned.
- A consent screen with per-scope toggles (auto-consent, consistent with #6: requested+registered scopes are granted wholesale).
- A dedicated native/CLI seed app — the existing **public Sample SPA** is reused (see Decisions); #19's Node CLI sample targets it.
- Polished password UX / MFA (#16).
- Any new DB migration — the existing `device_codes` table is sufficient (see Data changes).

---

## Contracts

### A. Device authorization endpoint
`POST /{tenant}/oauth2/v2.0/devicecode` — `application/x-www-form-urlencoded`, returns `application/json`, `Cache-Control: no-store`.

| Param | Required | Notes |
|---|---|---|
| `client_id` | yes | Must resolve to a registered app. Public clients send **no** secret; a confidential client may use this grant but must authenticate (`client_secret_post`/`client_secret_basic`) — shared `authenticateClient` ([#6](2026-06-22_06-auth-code-pkce-signin.md)). |
| `scope` | yes | Space-delimited. Validated identically to `/authorize` (#6): OIDC scopes (`openid profile email offline_access`) + registered/Graph resource scopes. At least one scope required. |

**Success** `200 application/json` (RFC 8628 §3.2):
```jsonc
{
  "device_code": "<opaque 256-bit base64url, plaintext to client>",
  "user_code": "BCDF-GHJK",
  "verification_uri": "https://localhost:8443/{tenant}/oauth2/v2.0/devicecode",
  "verification_uri_complete": "https://localhost:8443/{tenant}/oauth2/v2.0/devicecode?user_code=BCDF-GHJK",
  "expires_in": 900,
  "interval": 5,
  "message": "To sign in, open https://localhost:8443/{tenant}/oauth2/v2.0/devicecode in a browser and enter the code BCDF-GHJK to authenticate."
}
```
- `verification_uri` uses the **same `{tenant}` path segment the client used** (so it is reachable under whichever alias the device authority used) + `PUBLIC_ORIGIN`.
- `expires_in` = `TOKEN_LIFETIME_DEVICE_CODE_SECONDS` (default 900). `interval` = `DEVICE_CODE_INTERVAL_SECONDS` (default 5). Both already exist in config (`tokenLifetimes.deviceCode`, `deviceCodeInterval`).
- `message` is RFC 8628 §3.2-recommended human text; MSAL surfaces it via `deviceCodeCallback`.

**Errors** (canonical OAuth JSON, #6 shape; `Cache-Control: no-store`):

| Condition | `error` | HTTP |
|---|---|---|
| Missing `client_id`; unknown client; confidential client w/ bad/missing secret; public client presenting a secret | `invalid_client` | 401 |
| Missing/empty `scope`, or a scope not registered/allowed | `invalid_scope` | 400 |
| Malformed body / unsupported tenant alias | `invalid_request` | 400 |

### B. Token endpoint — device_code grant (polling)
`POST /{tenant}/oauth2/v2.0/token` — `application/x-www-form-urlencoded`.

| Param | Required | Notes |
|---|---|---|
| `grant_type` | yes | **Two values accepted**, both routed to the same handler: the canonical RFC 8628 URN **`urn:ietf:params:oauth:grant-type:device_code`** (the value advertised in discovery `grant_types_supported`) **and** the bare **`device_code`**. The bare form is required for interop: `@azure/msal-node` (via `@azure/msal-common` `GrantType.DEVICE_CODE_GRANT = "device_code"`) actually polls with the bare value — see Decisions. Both are registered as dispatch keys in `GRANT_HANDLERS`. |
| `device_code` | yes | The opaque token from endpoint A. |
| `client_id` | yes | Must equal the device code's `app_id`. |
| `client_secret` | confidential only | Via post/basic. |

> **Extra/telemetry parameters are tolerated.** `@azure/msal-node` sends additional fields on the device_code poll beyond the three above — e.g. `scope`, `client_info=1`, plus correlation/telemetry/library params (`client-request-id`, `x-client-SKU`, `x-client-VER`, etc.). Unknown/telemetry parameters are **ignored** (no `invalid_request`). In particular, a `scope` param on the poll, **if present, is ignored** and MUST NOT broaden or narrow the grant: the issued token's scopes are derived **solely** from the stored device-code `scopes` (captured at endpoint A). `client_info=1` is accepted; `client_info` is always emitted in the response regardless.

**Success** `200 application/json` — #5's `buildTokenResponse` (delegated): `access_token`, `id_token` (iff `openid` granted), `refresh_token` (iff `offline_access` granted), `client_info`, `token_type`, `expires_in`, `ext_expires_in`, `scope` (echo of granted scopes). `Cache-Control: no-store`, `Pragma: no-cache`. Tokens carry the **approving user's** claims (`oid`/`sub`/`scp`).

**Polling status → response mapping** (RFC 8628 §3.5):

> **Error-module extension (required).** The three device-code polling codes do **not** exist in the canonical `OAuthErrorCode` union (`src/identity/oauthErrors.ts`), which is closed. This feature **adds** `authorization_pending`, `access_denied`, and `expired_token` to the union, each with `DEFAULT_STATUS = 400` and a best-effort AADSTS code in `DEFAULT_AADSTS` (e.g. `authorization_pending`→70016, `access_denied`→65004, `expired_token`→70020). They reuse the existing `sendOAuthError` body shape verbatim.


| Device-code state | `error` | HTTP | Side effect |
|---|---|---|---|
| `pending` (not yet approved, not expired) | `authorization_pending` | 400 | none |
| `approved` | — (200 token set) | 200 | **atomic `deviceCodes.consumeApproved(hash, clientId, now)`** — conditional delete-and-return (`DELETE … WHERE device_code=? AND app_id=? AND status='approved' AND expires_at>? RETURNING *`); mint tokens **only** if it returned a non-null row, else `invalid_grant` (lost the race / already consumed) |
| `denied` | `access_denied` | 400 | delete row |
| present but `expires_at` ≤ now | `expired_token` | 400 | delete row (lazy expiry) |
| `device_code` unknown (incl. already-consumed) | `invalid_grant` | 400 | none |
| `device_code` exists but `app_id` ≠ authenticated `client_id` | `invalid_grant` | 400 | none |
| missing `device_code` param | `invalid_request` | 400 | none |
| client auth failure | `invalid_client` | 401 | none |

> No `slow_down` is ever returned (see Decisions). A re-poll after a successful 200 hits "unknown" → `invalid_grant` (single-use enforced by the atomic `consumeApproved` redemption — see below). Two concurrent polls of the same approved code can never both mint: `consumeApproved` is the single point of mutation, so exactly one observes the row and the other gets `invalid_grant`.

### C. Approval page (human-facing HTML)
All HTML responses are `text/html; charset=utf-8`, `Cache-Control: no-store`. Reuses #6's sign-in chrome (account-picker / password form, watermark, DESIGN tokens) via the shared `signinPage` render helpers. **Required helper extension:** `renderAccountPicker`/`renderPasswordForm` currently emit a fixed form (only `SIGNIN_FIELDS.state` + the picker/password inputs). This feature adds an optional **`extraHiddenFields?: Record<string,string>`** to their options, rendered as escaped `<input type="hidden">`s, so the device flow injects `__el_step=signin` + `user_code` into the same forms. **Stable field/heading names** (tests assert these):

Signed state + CSRF: `__el_state` is an HMAC-signed snapshot using a **generic signer** — this feature generalizes `authState.ts`'s `createAuthStateSigner` into a `createSignedStateSigner<T>()` (the existing `AuthorizeState`-typed signer becomes a thin `T = AuthorizeState` instantiation), and the device flow instantiates its own `T = DeviceApprovalState = { userCode: string; sid: string }` signer (`sid` **required**, not optional) with a per-process key. **Every consent-screen render** — whether reached directly via an existing `el_session` SSO (the `lookup` step, no signin) or via a fresh `signin` step — signs `DeviceApprovalState = { userCode, sid: currentSession.id }`, binding the state to the live session. **CSRF protection** on the `decide` step = `SameSite=Lax` cookie + a live `el_session` + the signed `__el_state` whose `sid` MUST be **present** AND **equal** to the current `el_session` id (re-checked server-side); a missing or mismatched `sid` is a CSRF rejection → error page. There is no separate decorative `csrf` token. On every step the device code is **re-loaded and re-validated** server-side (the signed field is never trusted alone).

Hidden/form fields:
- `user_code` — the code-entry input (free-form; normalized server-side: upper-cased, non-`[A-Z]` stripped, hyphen-regrouped).
- `__el_state` — signed `DeviceApprovalState` (`{ userCode, sid }`, `sid` required), re-verified server-side.
- `__el_step` — `lookup` | `signin` | `decide` (drives the `/verify` branch).
- `__el_user` / `__el_email` / `__el_username` / `__el_password` — reused #6 sign-in fields.
- `__el_decision` — `approve` | `deny` (decide step).

Steps:
1. **`GET /{tenant}/oauth2/v2.0/devicecode`** (optionally `?user_code=BCDF-GHJK`) → **code-entry page** (`<h1>Enter code</h1>`-class heading, `user_code` input pre-filled from the query, "Next" submits `__el_step=lookup` to `/verify`).
2. **`POST …/devicecode/verify` `__el_step=lookup`** → normalize + look up `user_code`:
   - not found / `expires_at` ≤ now / `denied` / already-`approved`/consumed → **error page** with a specific message ("That code wasn't found", "This code has expired", "This code was already used", "This request was denied"). HTTP 200 (HTML page), no redirect.
   - `pending` + valid → resolve `el_session`:
     - authenticated → render **consent screen** (heading "Approve sign-in", shows requesting app `displayName` + the requested scopes, `Approve`/`Deny` buttons posting `__el_step=decide` + `__el_decision`, carrying a fresh `__el_state` signed with `sid = currentSession.id` of the existing `el_session` — even though no signin step ran).
     - not authenticated → render **sign-in** (account-picker, or password form when `REQUIRE_PASSWORD`), carrying `__el_state` + `__el_step=signin`, posting to `/verify`.
3. **`POST …/devicecode/verify` `__el_step=signin`** → authenticate the selected/typed user (`users.verifyPassword` when `REQUIRE_PASSWORD`, else account-picker selection), create a session row and set the `el_session` cookie **first**, then `el_recent` (cookie-ordering invariant — see Constraints). Re-render the **consent screen** (step `decide`).
4. **`POST …/devicecode/verify` `__el_step=decide`** → verify `__el_state` + a live `el_session`, **and require `__el_state.sid` to be present and equal to the live `el_session` id** (missing/mismatch → CSRF rejection / error page); re-check the device code is still `pending` + unexpired:
   - `approve` → set `status='approved'`, `user_id` = session user id. Render **success page** (heading "You're all set", "Return to your device").
   - `deny` → set `status='denied'`. Render **denied page**.
   - stale/expired/raced code → error page.

---

## Behavior / flow

```mermaid
sequenceDiagram
  participant Dev as MSAL public client (device)
  participant DA as POST /devicecode (#15)
  participant Repo as device_codes repo (#15/#2)
  participant Browser as Human browser
  participant Approve as /devicecode (GET) + /devicecode/verify (#15)
  participant Token as POST /token (device_code grant, #15)
  participant TS as Token service (#5)

  Dev->>DA: client_id, scope
  DA->>Repo: insert {hash(device_code), user_code, app_id, scopes, status=pending, expires_at, interval}
  DA-->>Dev: device_code, user_code, verification_uri, expires_in=900, interval=5
  Note over Dev: displays user_code + verification_uri to the human; begins polling

  loop every >= interval seconds
    Dev->>Token: grant_type=device_code, device_code, client_id
    Token->>Repo: getByDeviceCodeHash(hash)
    alt pending
      Token-->>Dev: 400 authorization_pending
    end
  end

  Browser->>Approve: GET /devicecode (enter user_code)
  Approve->>Repo: getByUserCode -> pending
  Browser->>Approve: sign in (reuse #6 account-picker, sets el_session)
  Browser->>Approve: POST decide=approve
  Approve->>Repo: status=approved, user_id=<approver>

  Dev->>Token: grant_type=device_code, device_code, client_id
  Token->>Repo: getByDeviceCodeHash -> approved
  Token->>Repo: consumeApproved(hash, clientId, now) -> row (atomic, single-use)
  Token->>TS: buildTokenResponse({app, user, scopes, resource, grant:'device_code'})
  Token-->>Dev: 200 { access_token, id_token?, refresh_token?, client_info, scope }
```

### Validation rules (device authorization, endpoint A)
1. Normalize `{tenant}` ([#4](2026-06-22_04-oidc-discovery.md)); invalid → `invalid_request`.
2. `authenticateClient` (#6): unknown client / bad secret / public-client-with-secret → `invalid_client`.
3. `scope` present + valid. The `scopesAreValid` and `resolveResource` helpers are currently **module-private to `authorize.ts`**; this feature **extracts both (plus `OIDC_SCOPES`/`splitScopes`) into a shared `src/identity/scopes.ts`**, exported and imported by `authorize.ts`, the device-authorization handler, and the `device_code` grant handler in `token.ts`. The extraction is a **behavior-preserving literal move**: `/authorize` retains its exact current validation semantics (including its current leniency about bare non-OIDC scopes) — **no change to existing `/authorize` tests** — and `/devicecode` inherits those same rules verbatim (see Decisions). Empty/invalid `scope` → `invalid_scope`.
4. Generate `device_code` (256-bit base64url) + a unique `user_code` (format below; regenerate on the rare `UNIQUE` collision, bounded retries). Persist `device_codes` row: `device_code` column = `sha256(device_code)`, `user_code` plaintext, `app_id`, `scopes` (space-joined), `status='pending'`, `interval` = config, `expires_at` = now + deviceCode lifetime, `user_id` NULL.
5. Return the RFC JSON with `verification_uri` built from the request tenant segment.

### Validation rules (token, device_code grant)
1. `grant_type` matches either accepted device-code dispatch key (the canonical URN **or** the bare `device_code` — both map to this handler; see §B and Decisions). Any additional poll parameters (`scope`, `client_info`, correlation/telemetry/library fields) are **ignored**; a `scope` param, if sent, is discarded and never alters the granted scopes (those come solely from the stored device-code row).
2. `authenticateClient` (#6).
3. `device_code` present → `sha256` → `getByDeviceCodeHash`. Apply the status mapping table (§B), enforcing the `app_id` binding and lazy expiry.
4. On `approved`: **atomically redeem first** via `consumeApproved(hash, clientId, now)` (conditional delete-and-return guarded on `status='approved'` + `app_id` match + unexpired). If it returns **null** (lost the TOCTOU race, already consumed, expired between read and redeem, or `app_id` mismatch) → `invalid_grant`. On a non-null row: load `user_id`; if the user is gone/disabled → `invalid_grant` (row already removed). Recompute `resource` from stored scopes via the shared `resolveResource` (extracted to `src/identity/scopes.ts`, above). `buildTokenResponse({ app, user, scopes, resource, nonce:null, grant:'device_code' })`. Return 200 (`scope` envelope = granted scopes, mirroring #6). No separate non-atomic read-then-delete sequence is permitted on the success path.

### `user_code` format (owned here)
8 characters from the ambiguity-reduced charset **`BCDFGHJKLMNPQRSTVWXZ`** (20 consonants — no vowels, so no accidental words; excludes `0/1/O/I/L/U` to prevent transcription errors), grouped `XXXX-XXXX` for legibility (e.g. `BCDF-GHJK`). Stored/compared **case-insensitively, dashes/whitespace ignored**. 20^8 ≈ 2.56×10^10 keyspace; codes are single-use, short-lived (15 min) and gated behind interactive sign-in, so brute force is impractical. Justification: aligns with RFC 8628 §6.1's transcribability guidance; stored in plaintext because the human must type it and it is low-value without an authenticated approval.

### `device_code` format & storage (owned here)
Opaque high-entropy token via the shared `generateOpaqueToken()` (32 random bytes → base64url, 256-bit) — identical to auth codes / refresh tokens. **Stored hashed at rest** (`sha256` hex) in the `device_code` PK column; the plaintext is returned to the client once and never persisted. Justification: the `device_code` is a bearer credential the device polls with (like a refresh token), so it is hashed at rest for consistency with `refresh_tokens` (#5); lookups hash the presented value.

---

## Data changes
- **No DDL / no new migration.** The pre-existing `device_codes` table (`migration-001`) is sufficient: `device_code` (PK; holds the SHA-256 hash), `user_code` (UNIQUE — provides the lookup index for the approval page), `app_id`, `user_id` (set on approval), `scopes`, `status` (`pending`/`approved`/`denied`/`expired`), `interval`, `expires_at`, `created_at`. `resource` is **recomputed** from `scopes` at redemption (not stored); there is no `nonce` (RFC 8628 has no nonce) and no `last_polled_at` (no `slow_down` enforcement) — so no additive columns are needed.
- **New repository** `src/store/repositories/deviceCodes.ts` (modeled on `authCodes.ts`/`refreshTokens.ts`): `insert(NewDeviceCode)`, `getByDeviceCodeHash(hash)`, `getByUserCode(userCode)`, `userCodeExists(userCode)`, `approve(hashOrUserCode, userId)`, `deny(...)`, **`consumeApproved(hash, clientId, now)`** — the **atomic** single-use redemption: a conditional delete-and-return (`DELETE … WHERE device_code=? AND app_id=? AND status='approved' AND expires_at>? RETURNING *`), returning the row iff it was still present-and-approved-and-unbound-to-this-client, else `null` (this is the only op the token grant's success path uses to read+remove an approved code — it replaces any non-atomic `getByDeviceCodeHash`+`consume` pair on that path), `consume(hash)` (atomic delete-and-return, like `authCodes.consume`, used for lazy deletion of denied/expired rows), `deleteExpired(now)`. Registered in `repositories/index.ts` and surfaced on the `Store`/`Repositories` interface as `deviceCodes`. New types `DeviceCode`/`NewDeviceCode`/`DeviceCodeStatus` in `store/types.ts`.
- Writes: `device_codes` (insert on authorize; update on approve/deny; delete on consume/expiry). On approval, also writes `sessions` (sign-in) + sets `el_session`. Reads `app_registrations`, `app_redirect_uris` (none needed), `users`, `app_scopes`.

### Files touched / wiring
- **New:** `src/identity/deviceCode.ts` (endpoint A handler + `device_code` grant handler exported for `token.ts`), `src/identity/deviceApproval.ts` (GET page + `/verify` POST state machine), `src/store/repositories/deviceCodes.ts`, `src/identity/scopes.ts` (extracted shared `scopesAreValid`/`resolveResource`/`OIDC_SCOPES`/`splitScopes`), `src/identity/clientAuth.ts` (extracted shared `authenticateClient` + `parseBasicAuth` + the form-`field` reader, currently module-private to `token.ts`; imported by `token.ts`, the device-authorization handler, and the `device_code` grant handler so client-auth — Basic-vs-post precedence, public-client-secret rejection, `invalid_client` error shape — is single-sourced, not duplicated. The extraction is **behavior-preserving for the existing `/token` grants**: no change to existing `/token` client-auth tests).
- **Modified:** `src/identity/token.ts` (register the `device_code` grant in `GRANT_HANDLERS` under **both** keys — the canonical URN + the bare `device_code` MSAL actually sends — routed to the same handler; import `authenticateClient`/`parseBasicAuth`/form-field reader from the new `clientAuth.ts` instead of defining them locally — behavior-preserving); `src/identity/oauth.ts` `registerOAuthRoutes` (call a new `registerDeviceCodeRoutes(app)` that registers `POST /devicecode` (real), `GET /devicecode`, `POST /devicecode/verify`); `src/http/plugins.ts` (remove the `sendNotImplemented('#15')` 501 stub on `POST /devicecode`); `src/identity/metadata.ts` + `DiscoveryMetadata` interface (add `device_authorization_endpoint` + the URN grant); `src/identity/oauthErrors.ts` (add the 3 polling error codes); `src/identity/authState.ts` (generalize to `createSignedStateSigner<T>()`); `src/identity/signinPage.ts` (`extraHiddenFields` option); `src/store/repositories/index.ts` + `src/store/store.ts` (surface `deviceCodes`); `src/store/types.ts` (`DeviceCode`/`NewDeviceCode`/`DeviceCodeStatus`).
- **Tests modified:** `test/integration/discovery.test.ts` (invert the Iteration-1-lockstep absence assertions to presence; bump the baseline `grant_types_supported`).

---

## Dependencies & assumptions
- **Public Sample SPA reused as the device client.** Seed app `cccccccc-0000-0000-0000-000000000001` ("Sample SPA", `is_confidential=0`, scope `access_as_user`) is the only public client and is reused for the device-code scenario (and by #19's Node CLI sample). The `spa` redirect type is irrelevant to device code (no redirect is used). Documented divergence: real Entra requires a public client with "allow public client flows" enabled; the emulator does not gate on platform type.
- **Approving user** is a seeded enabled user (Alice `aaaaaaaa-0000-0000-0000-000000000001` / Bob `aaaaaaaa-0000-0000-0000-000000000002`, password `Password1!` when `REQUIRE_PASSWORD`).
- **Auto-consent** (consistent with #6): the consent screen is informational; clicking Approve grants all requested+registered scopes.
- **Determinism:** fixed tenant, seeded app/users, ephemeral DB, injectable clock. `user_code`/`device_code` are random; tests assert *shape* (regex) for the values and drive approval by reading the actual `user_code` from the authorize response.
- Confidential clients *may* use device code (must authenticate); MSAL's `PublicClientApplication` path is the primary scenario.
- **Tenant aliases (convention #8).** The device-code endpoints (`POST /devicecode`, `GET /devicecode`, `POST /devicecode/verify`, and the `device_code` poll on `/token`) accept **all** configured tenant aliases (`common` / `organizations` / `consumers` + the emulator GUID), normalized via #4. Issued tokens always bind to the emulator's single GUID tenant / issuer regardless of the alias used — a documented divergence from real Entra (which rejects some app types/flows on `/common`), harmless for a single-tenant dev tool. The `verification_uri` echoes whichever alias the device authority used (so the human reaches the page under the same alias).

---

## Testable acceptance criteria

### Integration — device authorization endpoint (via `app.inject`)
1. `POST /devicecode` with the public SPA `client_id` + `scope=openid profile offline_access` returns `200` JSON with: `device_code` (non-empty), `user_code` matching `^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$`, `verification_uri` ending `/oauth2/v2.0/devicecode`, `verification_uri_complete` containing `?user_code=`, `expires_in=900`, `interval=5`, a `message`; `Cache-Control: no-store`. A `device_codes` row exists with `status=pending` and `device_code` = SHA-256 hash (not the plaintext).
2. Missing/empty `scope` → `invalid_scope` (400); an unregistered resource scope → `invalid_scope`.
3. Unknown `client_id` → `invalid_client` (401); the public SPA presenting a `client_secret` → `invalid_client`.

### Integration — polling (`/token`, device_code grant)
4. Polling with a valid `device_code` **before approval** → `400 authorization_pending`.
5. After a server-side approval (flip `status='approved'`, set `user_id`), polling → `200` token set. Assert: `id_token` present **iff** `openid` requested; `refresh_token` present **iff** `offline_access` requested; `client_info` present; `Cache-Control: no-store`.
6. **Single-use:** a second poll after the successful 200 → `400 invalid_grant`, and the row is gone.
7. **Concurrent redemption (atomic single-use):** with a code in `status='approved'`, fire **two concurrent polls** → **exactly one** returns a `200` token set, the other returns `400 invalid_grant`; afterward the `device_codes` row is gone. (Verifies `consumeApproved` closes the TOCTOU window — no double-mint.)
8. **Extra MSAL poll parameters tolerated:** a poll of an approved code carrying additional fields (`scope=User.Read`, `client_info=1`, a telemetry header param) still returns `200` with the **originally-authorized** scopes in the `scope` envelope (the stray `scope` neither broadens nor narrows the grant).
9. **Denied:** with `status='denied'` → `400 access_denied`.
10. **Expired:** with `expires_at` in the past → `400 expired_token`, and the row is deleted (lazy).
11. **Binding:** polling a device code with a different `client_id` than its `app_id` → `400 invalid_grant`. Unknown `device_code` → `400 invalid_grant`. Missing `device_code` → `400 invalid_request`.

### Integration — approval page
12. `GET /devicecode` (no query) renders the **code-entry** page with a `user_code` input; `GET /devicecode?user_code=BCDF-GHJK` pre-fills it.
13. `POST /devicecode/verify __el_step=lookup` with a **valid pending** `user_code` while **authenticated** (`el_session` cookie) renders the **consent screen** showing the app `displayName` + requested scopes and a signed `__el_state` whose `sid` equals the live session id (direct-SSO path, no signin step).
14. `POST /devicecode/verify __el_step=decide __el_decision=approve` (authenticated + valid `__el_state` with matching `sid`) flips the row to `status='approved'` with the session user's id and renders the success page. A `decide` POST whose `__el_state.sid` is **absent or mismatched** vs the live `el_session` → CSRF-rejection error page, row unchanged.
15. Invalid/unknown `user_code` → "not found" error page; expired → "expired" error page; already-approved/denied → the corresponding error page (HTTP 200 HTML, no redirect).
16. **Unauthenticated lookup** renders the #6 sign-in account-picker; submitting `__el_step=signin __el_user=<alice id>` creates a session, sets `el_session` as **`Set-Cookie[0]`** (cookie-ordering preserved — the integration helper reads `Set-Cookie[0]`), then renders the consent screen; a subsequent approve completes.

### Token-conformance
17. The approved-flow `access_token` (and `id_token`) verify against the live JWKS; claims carry the **approving user's** identity: `oid` = approver's id, `sub` = pairwise subject (user+app), `scp` contains the granted delegated scopes; `id_token` (when `openid`) has `oid`/`preferred_username` = approver.

### Discovery
18. `GET …/.well-known/openid-configuration` now advertises `device_authorization_endpoint` = `${PUBLIC_ORIGIN}/${tenantId}/oauth2/v2.0/devicecode` and includes `urn:ietf:params:oauth:grant-type:device_code` in `grant_types_supported`. **Update** `test/integration/discovery.test.ts`: the Iteration-1-lockstep assertions that previously required these to be **absent** are inverted to require their presence (and `grant_types_supported` baseline updated to the 4-grant set).

### Real-MSAL e2e (`npm run test:e2e`)
19. A `@azure/msal-node` `PublicClientApplication` (authority `<origin>/{tenant}`, `knownAuthorities`, instance discovery disabled per `docs/msal-client-config.md`) calls `acquireTokenByDeviceCode({ scopes:['openid','profile','offline_access'], deviceCodeCallback })` against the running emulator with **`REQUIRE_PASSWORD=false`** (account-picker path, chosen for harness simplicity — no `__el_password` posting). The harness drives approval **headlessly** from inside the callback (a cookie-jar HTTP sequence, **not** Playwright):
    1. `POST /devicecode/verify` `__el_step=lookup&user_code=<response.userCode>` → capture the sign-in page's `__el_state`.
    2. `POST /devicecode/verify` `__el_step=signin&__el_user=<alice id>&__el_state=…` → capture `el_session` (Set-Cookie) + the consent `__el_state`.
    3. `POST /devicecode/verify` `__el_step=decide&__el_decision=approve&__el_state=…` with the `el_session` cookie → success.
    **Determinism contract:** `deviceCodeCallback` kicks off this sequence and exposes it as an `approvalPromise` (it does **not** block the poll loop); the test does `await Promise.all([acquireTokenPromise, approvalPromise])` (or equivalent) so a rejected/failed approval **fails the test fast** rather than letting MSAL poll until device-code expiry. `acquireTokenByDeviceCode` then resolves with an `accessToken`. Assert the token is JWKS-verifiable and `account.username` = `alice@entralocal.dev` (from `client_info`/`id_token`).

---

## Constraints
- **Cookie ordering:** the approval sign-in must set `el_session` **before** any other cookie (`el_recent`) so `Set-Cookie[0]` is `el_session` (integration helpers depend on it). Same `HttpOnly`/`SameSite=Lax`/`Secure`-when-TLS attributes and 8h lifetime as #6.
- **No `DESIGN.md` edits.** The approval/consent/success/error pages consume existing DESIGN tokens via the shared `signinPage` helpers; if the consent + "device approved" states need a new visual token, **flag it to the designer** rather than inventing one (none anticipated — reuses the sign-in card/watermark chrome).
- **Determinism:** injectable clock for expiry; random `user_code`/`device_code` validated by regex, with approval driven from the real authorize response.
- **Security:** `device_code` hashed at rest; `__el_state` HMAC-signed and re-verified, with server-side re-validation of the device code on every step (never trust the signed field alone); the approval `decide` step requires a live `el_session` **and** that the signed `__el_state.sid` is present and equal to the live session id (CSRF binding enforced on **every** consent render — including the direct-SSO `lookup` path that has no signin step — not only after a fresh signin).

## Decisions
| Decision | Options Considered | Choice | Rationale |
|---|---|---|---|
| `grant_type` value | URN only · bare `device_code` only · **both** | **Accept both** (URN canonical/advertised; bare also routed to the same handler) | RFC 8628 §3.4 defines the URN, so it is the canonical value advertised in discovery — but `@azure/msal-node` (`@azure/msal-common` `GrantType.DEVICE_CODE_GRANT = "device_code"`) polls `/token` with the **bare** `device_code`. Registering only the URN fails the real-MSAL e2e with `unsupported_grant_type`. Accepting both keeps standards-correct discovery while interoperating with the actual client. *(Corrected during implementation — the original spec premise that the URN is "the exact value MSAL sends" was empirically false; see Implementation correction below and the #15 addendum in `memory/decisions.md`.)* |
| `user_code` charset/format | digits, Crockford base32, Microsoft 9-char alnum, consonants-only | `BCDFGHJKLMNPQRSTVWXZ`, 8 chars, `XXXX-XXXX` | RFC 8628 §6.1 transcribability; no vowels (no words), no ambiguous glyphs; ample keyspace for a short-lived single-use code. |
| `device_code` storage | plaintext vs hashed | SHA-256 hashed in the PK column | It's a polled bearer credential; consistent with refresh-token at-rest hashing (#5). |
| `slow_down` | enforce via `last_polled_at` column vs advertise interval only | **Advertise `interval`, never emit `slow_down`** | Avoids a migration + timing-flaky tests; MSAL honors the advertised interval, so enforcement is unnecessary for compatibility. Documented divergence. |
| New migration? | additive `migration-002` (index/columns) vs reuse | **Reuse existing table, no migration** | Existing columns + the `user_code` UNIQUE index suffice; `resource` recomputed, no `nonce`/`last_polled_at` needed. |
| Approval route shape | overload POST `/devicecode` for both RFC + form vs split | `POST /devicecode` = RFC JSON only; `GET /devicecode` = page; `POST /devicecode/verify` = form | Cleanly separates the machine (JSON) and human (HTML) surfaces with no content-type sniffing. |
| `verification_uri_complete` param | Microsoft `otc=` vs RFC `user_code=` | `user_code=` | RFC 8628 §3.3.1 example; our own approval page parses it; MSAL reads `verification_uri` + `user_code` from the message regardless. |
| Not-found vs expired device_code on poll | `expired_token` for both vs split | found+expired → `expired_token`; unknown → `invalid_grant` | Distinguishes a typo/forged code from a genuinely-expired one; expired rows are lazily deleted. |
| Single-use after success | terminal `redeemed` status vs delete row vs read-then-delete | **Atomic conditional delete-and-return (`consumeApproved`)** | Read-then-delete is a TOCTOU hole: two concurrent polls could both observe `approved` and both mint. A single guarded `DELETE … WHERE status='approved' … RETURNING *` makes redemption atomic — exactly one poll wins, the loser gets `invalid_grant`. Mirrors `authCodes.consume`. |
| Device client app | add a native/CLI seed app vs reuse Sample SPA | **Reuse the public Sample SPA** | Only existing public client; redirect type is irrelevant to device code; keeps seed unchanged; #19 targets it. |
| Allowed client types | public-only vs public+confidential | Both (confidential must authenticate) | RFC 8628 permits both; `authenticateClient` already handles the split; primary path is public. |
| Scope-validation behavior on extraction | device-code inherits `/authorize`'s exact current behavior verbatim vs tighten both surfaces | **Inherit `/authorize`'s exact current behavior verbatim** | Pure extraction = zero behavior change, lowest risk. The shared `src/identity/scopes.ts` is a literal move of `scopesAreValid`/`resolveResource`/`OIDC_SCOPES`/`splitScopes` — `/authorize` keeps its current leniency about bare non-OIDC scopes, and `/devicecode` + the token grant apply the **same** rules. Tightening is deferred; if ever chosen it would require new `/authorize` regression tests and an explicit behavior-change call-out, so it is out of scope here. |
| Client-auth code location | leave `authenticateClient`/`parseBasicAuth`/form-field reader private to `token.ts` vs extract to a shared module | **Extract to `src/identity/clientAuth.ts`** | Endpoint A and the token grant both need identical client-auth (Basic-vs-post precedence, public-client-secret rejection, `invalid_client` shape); a shared module prevents divergence. Extraction is behavior-preserving for the existing `/token` grants. |
| Tenant aliases on device-code endpoints | restrict to GUID vs accept all aliases | **Accept all configured aliases** (`common`/`organizations`/`consumers` + GUID), tokens bind to the single GUID issuer | Mirrors convention #8 / #4 across the suite; documented divergence from real Entra's `/common` app-type gating, harmless for a single-tenant dev tool. |

## Review
Adversarial review (Decker) raised four high/medium findings; all resolved in this spec:
1. **(HIGH) Canonical error module lacks device-code codes.** `OAuthErrorCode` is a closed union with no `authorization_pending`/`access_denied`/`expired_token`. → Added an explicit error-module-extension note in §B and to the Files-touched list (new codes + `DEFAULT_STATUS`/`DEFAULT_AADSTS` entries).
2. **(MED) `scopesAreValid`/`resolveResource` are private to `authorize.ts`.** → Spec now mandates extracting them (plus `OIDC_SCOPES`/`splitScopes`) into a shared `src/identity/scopes.ts` imported by `authorize.ts`, the device-auth handler, and `token.ts`.
3. **(MED) signin render helpers can't carry device hidden fields.** → Spec now specifies an additive `extraHiddenFields?: Record<string,string>` option on the shared render helpers.
4. **(MED) `__el_state` signer reuse + CSRF binding underspecified.** → Spec now generalizes `createAuthStateSigner` into `createSignedStateSigner<T>()`, defines `DeviceApprovalState = { userCode, sid? }`, and states the `decide`-step anti-forgery contract (SameSite=Lax + live `el_session` + signed `sid` re-checked against the session id; device code re-validated server-side every step).

Reviewer confirmed (no change needed): the e2e headless-approval approach is realistic (msal-node's `deviceCodeCallback` is `=> void`, not awaited before polling); `POST /devicecode` vs `/devicecode/verify` is collision-free and both classify as reserved API paths (no SPA-fallback risk); the request-alias `verification_uri` vs GUID-form discovery endpoint is correct (MSAL reads `verification_uri` from the response).

### Second review pass (independent rubber-duck, 7 findings — all resolved)
1. **(HIGH-1) Non-atomic redemption (TOCTOU double-mint).** Read-then-delete let two concurrent polls both observe `approved` and both mint. → Mandated an **atomic** `deviceCodes.consumeApproved(hash, clientId, now)` (guarded `DELETE … WHERE status='approved' … RETURNING *`); mint only on a non-null return, else `invalid_grant`. Updated §B side-effect column, the token-grant validation rule, the mermaid, the repository contract (Data changes), and the Decisions row; added acceptance criterion **#7** (two concurrent polls → exactly one `200`, the other `400 invalid_grant`, row gone).
2. **(HIGH-2) CSRF `sid` binding missing on the direct-SSO path.** The `lookup` step renders consent directly when an `el_session` exists (no signin step), so `sid` could be unset. → Made `sid` **required** (`DeviceApprovalState = { userCode: string; sid: string }`); **every** consent render signs `sid = currentSession.id`, and `decide` requires `sid` present AND equal to the live `el_session` id (else CSRF rejection). Updated §C signed-state paragraph + steps, the hidden-fields list, the `createSignedStateSigner` type, Constraints "Security", and acceptance criteria #13/#14.
3. **(HIGH-3) Extra MSAL poll parameters.** msal-node sends `scope`/`client_info`/telemetry fields on the poll. → §B + token-grant validation rule now state unknown/telemetry params are ignored and a poll `scope` is discarded (granted scopes come solely from the stored row); added acceptance criterion **#8**.
4. **(MED-4) E2E determinism.** → Criterion **#19** now requires `deviceCodeCallback` to expose an `approvalPromise` and the test to `await Promise.all([acquireTokenPromise, approvalPromise])` (fail fast, no poll-until-expiry), and pins **`REQUIRE_PASSWORD=false`** (account-picker path).
5. **(MED-5) Scope-validation drift on extraction.** → Decided the `src/identity/scopes.ts` extraction is a **behavior-preserving literal move**: `/authorize` keeps its exact current (lenient) semantics with **no test changes**, and `/devicecode` inherits them verbatim. Recorded in the Decisions table and the device-auth validation rule.
6. **(MED-6) `authenticateClient` extraction.** → Files-touched now requires extracting `authenticateClient` + `parseBasicAuth` + the form-`field` reader into a shared `src/identity/clientAuth.ts` (behavior-preserving for existing `/token` grants); added a Decisions row.
7. **(LOW-7) Tenant-alias convention.** → Added a Dependencies bullet + Decisions row: device-code endpoints accept all configured aliases (`common`/`organizations`/`consumers` + GUID); issued tokens bind to the single GUID issuer — a documented, harmless divergence from real Entra (convention #8).

(Note: the first-pass summary above lists `DeviceApprovalState = { userCode, sid? }`; finding HIGH-2 in this pass supersedes it — `sid` is now required.)

### Implementation correction (during build, #15)
- **`grant_type` premise was empirically false.** The spec asserted the URN `urn:ietf:params:oauth:grant-type:device_code` is "the exact value `@azure/msal-node` sends." It is not: `@azure/msal-common` defines `GrantType.DEVICE_CODE_GRANT = "device_code"` and the `DeviceCodeClient` polls `/token` with that **bare** value (the first real-MSAL e2e failed with `unsupported_grant_type`). **Resolution:** `GRANT_HANDLERS` registers **both** keys (`DEVICE_CODE_GRANT` URN + bare `device_code`) to the same handler; the URN remains the only value advertised in discovery `grant_types_supported`. The §A/§B contract rows, token-grant validation rule 1, the Files-touched note, and the Decisions `grant_type` row above were corrected to match. An integration test asserts the bare value dispatches, and the e2e (#19) exercises the real client. A non-modifying addendum was appended to the existing #15 entry in `memory/decisions.md`.
