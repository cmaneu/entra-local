# Feature #2 — SQLite Store, Schema & Seed

- **Roadmap ref:** Iteration 1, feature #2 ("SQLite store, schema & seed").
- **Dependencies:** [#1](2026-06-22_01-server-config-tls-foundation.md) (config, folder layout, harness).
- **Status:** ⬜ Not started.

> **Canonical-reference notice.** This spec is the single source of truth for the **data model / SQL schema / seed data**. Features #3, #5, #6, #7, #8, #9, #10, #11, #15 MUST reference table/column names here rather than redefine them.

---

## Goal / outcome

A synchronous repository layer over Node's built-in `node:sqlite`, with a forward-only migration runner that creates the full schema (tenants, users, groups + membership, app registrations + redirect URIs + secrets + scopes + roles, signing keys, authorization codes, refresh tokens, sessions, and reserved device codes), plus deterministic seed and reset routines. After this feature, identity/token/graph/admin code reads and writes durable, queryable state with fixed-GUID seed data for reproducible CI.

---

## Scope

### In scope
- `node:sqlite` connection management (`store/db.ts`): open DB at `config.dbPath`, `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout`.
- Forward-only migration runner (`store/migrations/`) tracked in a `schema_migrations` table; idempotent on boot.
- Full schema (DDL) for all entities below, with indexes and FKs.
- Typed, synchronous repository modules (`store/repositories/*`) exposing CRUD/query methods used by later features.
- Deterministic seed (`store/seed.ts`) with fixed GUIDs: tenant, ≥2 users, ≥1 group with membership, a public SPA app + a confidential daemon app (with a known hashed secret), exposed scope + app role.
- Reset routine (`store/reset.ts`): drop/recreate (or `DELETE` all rows) then optionally re-seed.
- A Fastify plugin (`store/plugin.ts`) that opens the DB, runs migrations, conditionally seeds (`SEED_ON_START`), decorates `app.store` (the repository bundle), and closes the DB on `app.close()`.
- Secret/password hashing helper (argon2id or scrypt via `node:crypto`) shared by seed + #11.

### Out of scope
- Admin REST API endpoints (#11) — repositories are consumed there; #2 ships the data layer only.
- Token minting/validation logic (#5) — #2 stores code/refresh/key rows; semantics live in #5.
- Device code issuance (#15) — the `device_codes` table is created now (reserved) but unused until #15.
- Key generation crypto (#3) — #2 provides the `signing_keys` table + repository; #3 owns generation/JWKS.

---

## Contracts

### Driver & connection
- `node:sqlite` (`import { DatabaseSync } from 'node:sqlite'`). **No `better-sqlite3`.** Synchronous API → repositories are synchronous functions.
- Single shared connection per process (SQLite handles serialization; WAL allows concurrent reads). Tests use an isolated ephemeral file per [#1](2026-06-22_01-server-config-tls-foundation.md)'s harness.
- All identifiers (`id`, `oid`, `kid`, `appId`, codes, tokens) are stored as text. GUIDs are lowercase canonical UUID strings.
- Timestamps stored as **integer Unix epoch seconds** (UTC) for deterministic comparison; `*_at` columns.

### Schema (DDL contract)

`schema_migrations`
| Column | Type | Notes |
|---|---|---|
| `version` | INTEGER PK | Applied migration number. |
| `applied_at` | INTEGER NOT NULL | Epoch seconds. |

`tenants`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Tenant GUID (default `1111...1111`). |
| `display_name` | TEXT NOT NULL | e.g. `Entra Local`. |
| `issuer` | TEXT NOT NULL | `${origin}/${id}/v2.0`. |
| `created_at` | INTEGER NOT NULL | |

`users`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | User GUID (== `oid`). |
| `tenant_id` | TEXT NOT NULL FK→tenants.id | |
| `user_principal_name` | TEXT NOT NULL UNIQUE | UPN / `preferred_username`. |
| `display_name` | TEXT NOT NULL | |
| `given_name` | TEXT | |
| `surname` | TEXT | |
| `mail` | TEXT | `email` claim source. |
| `password_hash` | TEXT | Nullable (account picker mode). Hashed (argon2id/scrypt). |
| `account_enabled` | INTEGER NOT NULL DEFAULT 1 | Boolean 0/1. |
| `created_at` | INTEGER NOT NULL | |
- Indexes: `UNIQUE(tenant_id, user_principal_name)`; index on `mail`.

`groups`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Group GUID. |
| `tenant_id` | TEXT NOT NULL FK→tenants.id | |
| `display_name` | TEXT NOT NULL | |
| `description` | TEXT | |
| `created_at` | INTEGER NOT NULL | |

`group_members` (junction)
| Column | Type | Notes |
|---|---|---|
| `group_id` | TEXT NOT NULL FK→groups.id ON DELETE CASCADE | |
| `user_id` | TEXT NOT NULL FK→users.id ON DELETE CASCADE | |
- PK `(group_id, user_id)`; index on `user_id`.

`app_registrations`
| Column | Type | Notes |
|---|---|---|
| `app_id` | TEXT PK | client_id GUID. |
| `tenant_id` | TEXT NOT NULL FK→tenants.id | |
| `display_name` | TEXT NOT NULL | |
| `is_confidential` | INTEGER NOT NULL DEFAULT 0 | 0=public/SPA, 1=confidential. |
| `app_id_uri` | TEXT | Identifier URI for exposed scopes (e.g. `api://<appId>`). |
| `created_at` | INTEGER NOT NULL | |
- Index on `tenant_id`.

`app_redirect_uris`
| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `app_id` | TEXT NOT NULL FK→app_registrations.app_id ON DELETE CASCADE | |
| `uri` | TEXT NOT NULL | Exact-match redirect URI. |
| `type` | TEXT NOT NULL DEFAULT 'web' | `web` \| `spa` \| `native` (informational). |
- `UNIQUE(app_id, uri)`.

`app_secrets`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Secret GUID (`keyId`). |
| `app_id` | TEXT NOT NULL FK→app_registrations.app_id ON DELETE CASCADE | |
| `display_name` | TEXT | |
| `secret_hash` | TEXT NOT NULL | Hashed secret (never plaintext at rest). |
| `hint` | TEXT | First/last few chars for portal display. |
| `expires_at` | INTEGER | Nullable. |
| `created_at` | INTEGER NOT NULL | |
- Plaintext secret returned **once** at creation time by #11; only the hash persists. Seed uses a known dev secret (intentional, documented).

`app_scopes` (exposed delegated scopes / `scp` values)
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Scope GUID. |
| `app_id` | TEXT NOT NULL FK→app_registrations.app_id ON DELETE CASCADE | |
| `value` | TEXT NOT NULL | Scope name, e.g. `access_as_user`. |
| `admin_consent_display_name` | TEXT | |
| `is_enabled` | INTEGER NOT NULL DEFAULT 1 | |
- `UNIQUE(app_id, value)`.

`app_roles` (`roles` for app-only / assigned)
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Role GUID. |
| `app_id` | TEXT NOT NULL FK→app_registrations.app_id ON DELETE CASCADE | |
| `value` | TEXT NOT NULL | Role value, e.g. `Tasks.Read.All`. |
| `display_name` | TEXT | |
| `allowed_member_types` | TEXT NOT NULL DEFAULT 'Application' | CSV: `Application`/`User`. |
| `is_enabled` | INTEGER NOT NULL DEFAULT 1 | |
- `UNIQUE(app_id, value)`.

`signing_keys` (owned operationally by [#3](2026-06-22_03-signing-keys-jwks.md))
| Column | Type | Notes |
|---|---|---|
| `kid` | TEXT PK | Key id (stable). |
| `tenant_id` | TEXT NOT NULL FK→tenants.id | |
| `alg` | TEXT NOT NULL DEFAULT 'RS256' | |
| `public_jwk` | TEXT NOT NULL | Public JWK JSON. |
| `private_pkcs8` | TEXT NOT NULL | PEM/PKCS8 private key (dev tool — plaintext at rest, documented). |
| `is_active` | INTEGER NOT NULL DEFAULT 1 | Active signer flag (one active per tenant). |
| `created_at` | INTEGER NOT NULL | |
| `not_after` | INTEGER | Nullable; rotation-readiness. |
- Index on `(tenant_id, is_active)`.

`authorization_codes` (owned operationally by [#5](2026-06-22_05-token-service.md)/[#6](2026-06-22_06-auth-code-pkce-signin.md))
| Column | Type | Notes |
|---|---|---|
| `code` | TEXT PK | Opaque random code (high entropy). |
| `app_id` | TEXT NOT NULL FK→app_registrations.app_id | |
| `user_id` | TEXT NOT NULL FK→users.id | |
| `redirect_uri` | TEXT NOT NULL | Must match exchange. |
| `scopes` | TEXT NOT NULL | Space-delimited granted scopes. |
| `resource` | TEXT | Resource/audience target if any. |
| `code_challenge` | TEXT | PKCE challenge. |
| `code_challenge_method` | TEXT | `S256` \| `plain`. |
| `nonce` | TEXT | Echoed into ID token. |
| `expires_at` | INTEGER NOT NULL | |
| `consumed` | INTEGER NOT NULL DEFAULT 0 | Single-use flag. |
| `created_at` | INTEGER NOT NULL | |
- Index on `expires_at` (cleanup).

`refresh_tokens` (owned operationally by feature #7 — Refresh Token flow, Batch B)
| Column | Type | Notes |
|---|---|---|
| `token` | TEXT PK | Opaque random token (stored hashed; see note). |
| `app_id` | TEXT NOT NULL FK→app_registrations.app_id | |
| `user_id` | TEXT NOT NULL FK→users.id | |
| `scopes` | TEXT NOT NULL | |
| `resource` | TEXT | |
| `expires_at` | INTEGER NOT NULL | |
| `rotated_from` | TEXT | Prior token id (rotation chain). |
| `revoked` | INTEGER NOT NULL DEFAULT 0 | |
| `created_at` | INTEGER NOT NULL | |
- **Note:** refresh tokens are stored **hashed** (SHA-256) with the PK being the hash; the plaintext is only returned to the client. (#7 finalizes rotation semantics.) Index on `(app_id, user_id)`.

`sessions` (emulator browser SSO session for `/authorize`, owned by [#6](2026-06-22_06-auth-code-pkce-signin.md))
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Session id (random; set as `HttpOnly` cookie). |
| `user_id` | TEXT NOT NULL FK→users.id | Signed-in user. |
| `created_at` | INTEGER NOT NULL | |
| `expires_at` | INTEGER NOT NULL | |
- Index on `expires_at`.

`device_codes` (**reserved** for feature #15 — Device Code flow, Iteration 2; created but unused in Iteration 1)
| Column | Type | Notes |
|---|---|---|
| `device_code` | TEXT PK | |
| `user_code` | TEXT NOT NULL UNIQUE | Short user-entered code. |
| `app_id` | TEXT NOT NULL FK→app_registrations.app_id | |
| `user_id` | TEXT | Set on approval. |
| `scopes` | TEXT NOT NULL | |
| `status` | TEXT NOT NULL DEFAULT 'pending' | `pending`/`approved`/`denied`/`expired`. |
| `interval` | INTEGER NOT NULL DEFAULT 5 | |
| `expires_at` | INTEGER NOT NULL | |
| `created_at` | INTEGER NOT NULL | |

### Repository API (representative)
Synchronous methods, grouped per entity, e.g.:
- `users`: `getById`, `getByUpn`, `list({skip,top})`, `create`, `update`, `delete`, `verifyPassword`.
- `groups`: `getById`, `list`, `create`, `update`, `delete`, `addMember`, `removeMember`, `listMembers`, `listGroupsForUser`.
- `apps`: `getByAppId`, `list`, `create`, `update`, `delete`, redirect-URI/secret/scope/role sub-methods, `verifySecret(appId, plaintext)`.
- `signingKeys`: `getActive(tenantId)`, `getByKid`, `listPublic(tenantId)`, `insert`, `setActive`.
- `authCodes`: `insert`, `getByCode`, `consume` (atomic compare-and-set on `consumed`), `deleteExpired`.
- `refreshTokens`: `insert`, `getByHash`, `rotate`, `revoke`, `deleteExpired`.
- `sessions`: `create`, `get`, `delete`, `deleteExpired`.
- `tenants`: `get`, `getDefault`.

### Config keys consumed
`DB_PATH`, `SEED_ON_START` (from [#1](2026-06-22_01-server-config-tls-foundation.md)). `SEED_ON_START` defaults to seeding when the DB has no tenant row.

---

## Behavior / flow

### Boot (store plugin)
1. Open `DatabaseSync(config.dbPath)`; set pragmas (WAL, FK on, busy_timeout=5000).
2. Run migrations: read applied `version`s from `schema_migrations`; apply pending migrations in a transaction; record each version.
3. If `SEED_ON_START` and the DB is empty (no tenant) → run seed in a transaction.
4. Decorate `app.store` with the repository bundle; register `onClose` to close the DB.

### Determinism / seed data (fixed GUIDs)
- Tenant `11111111-1111-1111-1111-111111111111` (`Entra Local`).
- Users (fixed GUIDs), e.g.:
  - `aaaaaaaa-0000-0000-0000-000000000001` — `alice@entralocal.dev` (display `Alice Example`, mail set).
  - `aaaaaaaa-0000-0000-0000-000000000002` — `bob@entralocal.dev`.
  - Seeded password (when `REQUIRE_PASSWORD`) is a known dev value, hashed, documented.
- Group `bbbbbbbb-0000-0000-0000-000000000001` — `Engineering`, members: Alice + Bob.
- Apps (fixed GUIDs):
  - Public SPA `cccccccc-0000-0000-0000-000000000001` — `Sample SPA`, `is_confidential=0`, redirect URIs incl. `https://localhost:3000`, exposes scope `access_as_user`.
  - Confidential daemon `cccccccc-0000-0000-0000-000000000002` — `Sample Daemon`, `is_confidential=1`, one secret (known dev plaintext, stored hashed), app role `Tasks.Read.All`.
- Signing key: generated by [#3](2026-06-22_03-signing-keys-jwks.md), **not** hardcoded (real RSA material). For deterministic CI, the test harness may pre-seed a fixed test key via #3's repository so JWKS/token signatures are reproducible — see #3.
- All seed timestamps use a fixed epoch in test mode (injected clock) so rows are byte-stable; in normal runtime, real `now()`.

### Reset
- `POST /admin/api/reset` (#11) → `store.reset({ reseed })`: within a transaction, `DELETE` from all data tables (preserving `schema_migrations`), then re-run seed if `reseed`. Signing keys: reset preserves the active signing key by default (stable `kid`); a `resetKeys` flag (default false) is honored to regenerate.

---

## Data changes
This feature **creates** the entire schema above. All later features reference these tables/columns; only #11 (admin) and the flow features add rows at runtime. No schema changes are made by later Iteration-1 features except #15 (uses the reserved `device_codes` table) — no DDL change needed.

---

## Dependencies & assumptions
- **Node 22.5+** for `node:sqlite` (RC). Pinned in #1.
- **Assumption:** synchronous repository calls are acceptable inside Fastify handlers for a local dev tool (no high-concurrency requirement); WAL + short transactions keep this safe.
- **Assumption:** storing private signing keys and seed secrets in plaintext/known form is intentional for a dev tool (documented in README security disclaimer).
- **Assumption:** SHA-256 is sufficient for refresh-token/at-rest token hashing (opaque high-entropy tokens, not passwords); user passwords use argon2id/scrypt.

---

## Testable acceptance criteria
1. **Migrations (integration):** booting against an empty ephemeral DB creates all tables and records migration versions; a second boot is a no-op (idempotent).
2. **FK + cascade (unit):** deleting an app cascades its redirect URIs/secrets/scopes/roles; deleting a user removes its group memberships and sessions.
3. **Seed determinism (integration):** seeding an empty DB yields the exact fixed GUIDs and row counts above; seeding is skipped when a tenant already exists.
4. **Repository CRUD (unit):** create/read/update/delete round-trips for users, groups (+membership), and apps (+redirect URIs/secrets/scopes/roles) return the expected typed shapes.
5. **Password & secret hashing (unit):** `verifyPassword`/`verifySecret` succeed for the correct value and fail otherwise; no plaintext is persisted (`password_hash`/`secret_hash` ≠ input).
6. **Auth code single-use (unit):** `authCodes.consume` succeeds once and fails (or returns already-consumed) on a second call — atomic.
7. **Refresh token hashing (unit):** stored token PK is the SHA-256 hash; lookup by plaintext-derived hash succeeds; revoke/rotate flags behave.
8. **Reset (integration):** `store.reset({reseed:true})` empties data tables and restores seed; the active signing key/`kid` is preserved unless `resetKeys`.
9. **Ephemeral isolation (harness):** two `buildTestApp()` instances operate on independent DBs with no cross-talk.
10. **Pragmas (unit):** WAL mode and `foreign_keys=ON` are active on the opened connection.

---

## Open questions
None blocking. *(Decision: refresh tokens and sessions are stored hashed/opaque; private signing keys are stored as PKCS8 in plaintext — acceptable for a documented dev tool. Decision: timestamps are epoch-seconds integers for deterministic comparison.)*
