# Decisions

<!-- Append new decisions at the end using this format:

### <Decision Title>
- **Date**: YYYY-MM-DD
- **Context**: What prompted this decision
- **Decision**: What was decided
- **Rationale**: Why this choice
- **Alternatives**: What else was considered
-->

### Project scope: Entra ID emulator for app developers
- **Date**: 2026-06-22
- **Context**: Project kickoff. Need a local IdP so MSAL-based apps can develop/test sign-in and token flows without a real Entra ID tenant.
- **Decision**: Build "Entra Local" — an emulator exposing MSAL-compatible OIDC/OAuth2 endpoints, a minimal Microsoft Graph read surface, and a portal for managing users and app registrations. Captured in `specs/global-spec.md`.
- **Rationale**: Removes cloud dependency; enables offline/CI testing; avoids polluting shared tenants.
- **Alternatives**: Use a real test tenant; use a generic OIDC server (e.g. Keycloak) — rejected for lack of Entra/MSAL endpoint parity.

### Tech stack: Node.js + TypeScript with React portal
- **Date**: 2026-06-22
- **Context**: Need to choose the implementation stack.
- **Decision**: Node.js + TypeScript for the server; React + TypeScript (Vite) for the portal; `jose` for JWT/JWKS; SQLite for persistence; `zod` for validation.
- **Rationale**: Strong OAuth/OIDC ecosystem, easy single-exe packaging (Node SEA/pkg), fast portal development.
- **Alternatives**: .NET (natural Entra fit), Go (small static binary), Python/FastAPI — viable but Node chosen for portal velocity and packaging.

### MVP protocol scope
- **Date**: 2026-06-22
- **Context**: Defining which auth flows the emulator must support.
- **Decision**: Support Authorization Code + PKCE, Client Credentials, Refresh Token, and Device Code, plus OIDC discovery, JWKS, userinfo, and logout. Exclude Implicit, ROPC, OBO, SAML, and WS-Fed from the MVP.
- **Rationale**: Covers the dominant modern MSAL scenarios while keeping MVP focused.
- **Alternatives**: Add legacy flows (Implicit/ROPC) or SAML/WS-Fed — deferred/out of scope.

### Persistence: SQLite file
- **Date**: 2026-06-22
- **Context**: Choosing how to store users, apps, tenants, signing keys, and tokens.
- **Decision**: SQLite file with a repository layer; deterministic seed data; signing keys persisted for stable `kid`/signatures.
- **Rationale**: Persists across restarts, zero external deps, easy to reset/seed for CI.
- **Alternatives**: In-memory only (ephemeral), JSON files (no transactions/queries), pluggable store — deferred.

### Single tenant for MVP
- **Date**: 2026-06-22
- **Context**: Deciding directory cardinality.
- **Decision**: One fixed tenant (default GUID `11111111-1111-1111-1111-111111111111`); accept `common`/`organizations`/`consumers` aliases routing to it. Designed so multi-tenant can be added later.
- **Rationale**: Simplest mental model for the MVP.
- **Alternatives**: Full multi-tenant — moved to roadmap.

### TLS: HTTPS by default with auto-generated self-signed cert
- **Date**: 2026-06-22
- **Context**: MSAL fetches discovery/JWKS over HTTP(S); real-world parity benefits from HTTPS.
- **Decision**: HTTPS by default using an auto-generated, persisted self-signed cert; allow custom cert/key override and an HTTP fallback toggle.
- **Rationale**: Closer to real Entra behavior and avoids mixed-content issues; stable fingerprint across restarts.
- **Alternatives**: HTTP-only via loopback exemption; HTTPS opt-in — rejected in favor of secure-by-default.

### Sign-in UX and portal access
- **Date**: 2026-06-22
- **Context**: Interactive sign-in for Authorization Code flow and access control for the admin portal.
- **Decision**: Account picker by default with optional password enforcement (`REQUIRE_PASSWORD`); admin portal is open/unauthenticated.
- **Rationale**: Optimizes for local dev speed while allowing more realistic password login when needed.
- **Alternatives**: Password-only login; admin-protected portal — available as future toggles.

### Packaging targets
- **Date**: 2026-06-22
- **Context**: How developers will run the emulator.
- **Decision**: Support `npm start`, a single self-contained executable, and a Docker container as first-class targets sharing one config/data model.
- **Rationale**: Meets developers where they are (source, binary, or container/CI).
- **Alternatives**: Single target only — rejected to maximize adoption.

### Roadmap & MVP cut
- **Date**: 2026-06-22
- **Context**: Following the global spec, needed an ordered, deliverable roadmap with a clear MVP boundary. Captured in `specs/roadmap.md`.
- **Decision**: Iteration 1 (MVP) delivers the core sign-in + token + consume loop: server/config/TLS, SQLite store+seed, signing keys+JWKS, OIDC discovery, token service, Authorization Code + PKCE with account-picker sign-in, Refresh Token, Client Credentials, UserInfo+Logout, minimal Graph (/me,/users,/groups), admin REST API, web portal, MSAL compatibility validation, and npm/Docker run targets. Iteration 2 adds Device Code, optional password login, and single-executable packaging.
- **Rationale**: User opted for a focused first ship but added Refresh Token + Client Credentials (cheap, commonly needed). Adversarial review (reviewer/Decker) flagged that the discovery doc advertises userinfo/logout and that MVP must be able to consume its own access tokens — so UserInfo/Logout and minimal Graph were pulled into Iteration 1. An explicit MSAL-compatibility validation milestone was added since MSAL compat is the #1 goal and highest risk.
- **Alternatives**: (a) Match global-spec §15 exactly (all flows + single-exe in MVP) — rejected as MVP bloat; (b) seed-only MVP with portal deferred — rejected since the portal is a primary product requirement.

### v1.0 acceptance criteria sequenced across iterations
- **Date**: 2026-06-22
- **Context**: Global-spec §15 acceptance criteria conflicted with the tighter roadmap MVP (Device Code and single-exe deferred to Iteration 2).
- **Decision**: Treat global-spec §15 as the full v1.0 bar delivered across Iterations 1-2; criterion 3 (Device Code) and the single-executable part of criterion 7 are met at the end of Iteration 2. Reconciled §15 with explicit per-criterion iteration tags.
- **Rationale**: Keeps the two documents consistent and makes the deferral a deliberate, documented choice rather than a silent contradiction (adversarial review finding).
- **Alternatives**: Pull Device Code + single-exe into the MVP to match §15 verbatim — rejected to preserve a focused first ship.

### Post-MVP iterations: sample apps and public documentation
- **Date**: 2026-06-22
- **Context**: Roadmap iteration. Need external-developer adoption assets and confidence that the emulator works across MSAL platforms.
- **Decision**: Add Iteration 3 (multi-language MSAL sample apps under `samples/`: JS `msal-browser`, React `msal-react`, Node `msal-node` web+daemon, .NET MSAL.NET, Python MSAL Python) and Iteration 4 (public developer documentation: getting-started, per-platform MSAL guides, API/config/claims reference, cert-trust troubleshooting).
- **Rationale**: Samples double as living documentation and as the real-MSAL end-to-end/regression fixtures that prove cross-platform compatibility (the project's #1 goal). Docs sequenced after samples so they can reference runnable examples.
- **Alternatives**: Ship docs without samples (rejected — examples are the most effective docs and also serve as test fixtures); fold samples/docs into Iteration 2 (rejected — they are adoption polish, not core product).

### Autopilot-ready execution model
- **Date**: 2026-06-22
- **Context**: Requirement that coding agents can build the project on autopilot and verify their work along the way.
- **Decision**: (1) Feature #1 scaffolds the toolchain — npm scripts (`dev`/`build`/`test`/`test:e2e`/`lint`/`typecheck`), test harness, and CI. (2) global-spec gained §16 Testing & Verification Strategy (unit / integration / token-conformance / real-MSAL e2e). (3) roadmap gained an Execution Model section with a universal per-feature Definition of Done. (4) memory/conventions.md captures repo layout, the npm script contract, testing layers, per-feature spec location, DoD, and determinism rules.
- **Rationale**: A dependency-ordered roadmap plus per-feature testable acceptance criteria and a stable test/lint/build contract lets agents implement and self-verify each feature incrementally without a human in the loop.
- **Alternatives**: Leave verification to per-feature specs only (rejected — no shared contract/toolchain means inconsistent, unverifiable increments).

### Node.js CLI as a first-class sample (Device Code)
- **Date**: 2026-06-22
- **Context**: User requirement that the sample apps must include a Node.js CLI. Device Code (feature #15) previously lacked a runnable living-doc/regression sample.
- **Decision**: Make a Node.js CLI a required deliverable of the Node samples (feature #19), authenticating via the Device Code flow; #19 now depends on Device Code (#15) in addition to 6, 8, 13.
- **Rationale**: Device Code is the canonical headless/CLI auth pattern, so a CLI is the natural sample to exercise it; this gives #15 a living-doc sample and a real-MSAL regression fixture, resolving an earlier review gap.
- **Alternatives**: Node CLI via interactive/loopback auth-code (rejected — device code is the idiomatic CLI flow and was otherwise unsampled); keep the CLI optional (rejected — user made it a firm requirement).

### Iteration 1 HTTP framework: Fastify
- **Date**: 2026-06-22
- **Context**: Open roadmap decision tagged to Feature #1. Needed an HTTP framework for the emulator's OIDC/STS, Graph, and admin surfaces, resolved before writing Iteration 1 specs.
- **Decision**: Fastify (TypeScript).
- **Rationale**: First-class TS types and JSON-schema validation align with our validation approach; `fastify.inject()` directly powers the in-process integration-test layer our conventions require; built-in pino logging; plugin/encapsulation model maps cleanly onto the identity / graph / admin route groups.
- **Alternatives**: Express — wider familiarity but weaker TS ergonomics, no built-in schema validation, and less ergonomic in-process testing.

### Iteration 1 single-origin port & path layout
- **Date**: 2026-06-22
- **Context**: Open roadmap decision tagged to Feature #1 (serve the portal on the API port or a separate port). Needed a concrete URL map that emulates Entra's separate STS (`login.microsoftonline.com`) and Graph (`graph.microsoft.com`) hosts on a single local origin.
- **Decision**: Single port/origin. Portal SPA at `/` (SPA fallback for unmatched non-API routes); OIDC/STS under `/{tenant}/...` where `{tenant}` is allowlisted to the tenant GUID plus `common`/`organizations`/`consumers` — discovery at `/{tenant}/v2.0/.well-known/openid-configuration`, JWKS at `/{tenant}/discovery/v2.0/keys`, and `/{tenant}/oauth2/v2.0/{authorize,token,logout,devicecode}`; minimal Graph under `/graph/v1.0/{me,users,groups}` with UserInfo at `/graph/oidc/userinfo`; admin REST API under `/admin/api/...`; health at `/health`. In development the Vite dev server proxies to the API for HMR. MSAL configures `authority = <origin>/{tenant}` and Graph base `<origin>/graph`.
- **Rationale**: One origin means one cert to trust, no CORS, and trivial Docker/single-exe distribution; reserved path prefixes plus an allowlisted tenant segment prevent SPA/API route collisions; the prefix split mirrors Entra's real STS-vs-Graph host separation.
- **Alternatives**: Separate ports for portal and API — cleaner dev separation but doubles cert-trust/CORS friction and complicates packaging; rejected.

### Iteration 1 persistence driver: node:sqlite
- **Date**: 2026-06-22
- **Context**: Open roadmap decision tagged to Feature #2 (`better-sqlite3` vs `node:sqlite`); also interacts with the Iteration 2 single-executable goal (#17).
- **Decision**: Use Node's built-in `node:sqlite` (RC stage). Sets a Node 22.5+ floor (target current LTS / Node 24). Supersedes the unspecified "SQLite" driver in the earlier tech-stack decision.
- **Rationale**: No native bindings → simpler installs and a much easier path to the single-executable target (#17), avoiding `better-sqlite3`'s native-binding packaging problem; built into the runtime; synchronous API keeps the repository layer simple. User-directed.
- **Alternatives**: `better-sqlite3` — mature/fast but native bindings complicate single-exe packaging; rejected in favor of packaging simplicity. The newer-runtime requirement of `node:sqlite` is accepted given its RC-stage maturity.

### Iteration 1 cross-cutting spec contracts (Batch A: features #1–#6)
- **Date**: 2026-06-22
- **Context**: Writing the Batch A Iteration-1 specs surfaced cross-cutting contract choices that affect every later feature and that adversarial review (Decker) flagged for consistency/MSAL-correctness.
- **Decision**:
  1. **Reserved-stub lockstep.** Feature #1 registers `501 Not Implemented` JSON stubs for *all* canonical OIDC/OAuth/UserInfo/Graph paths in the path map; each later feature replaces its stub with a real handler. So every advertised discovery endpoint always resolves to a registered route (never a bare `404`/SPA), and the discovery doc can advertise core endpoints in dependency order without producing advertised-`404`s.
  2. **`client_info` in delegated token responses.** The token endpoint returns `client_info = base64url({uid:oid, utid:tenantId})` for user-present flows (auth code, refresh) to give MSAL stable account identity / cache keys; omitted for app-only client-credentials. Auth-code e2e pins MSAL's default AAD `protocolMode` + `knownAuthorities`.
  3. **Concrete-GUID issuer for all tenant aliases.** Requests via `common`/`organizations`/`consumers`/GUID all return the same GUID-form `issuer` (`${origin}/${TENANT_ID}/v2.0`), which equals every token `iss`. (Real Entra `/common` returns a templated `{tenantid}` issuer; the concrete GUID is simpler and MSAL-valid for a single fixed tenant. Cross-platform MSAL.NET/Python validation is #13.)
  4. **UserInfo path resolution.** UserInfo lives at `/graph/oidc/userinfo` (locked single-origin decision), overriding the draft global-spec `/{tenant}/openid/userinfo`. Discovery advertises this.
  5. **Determinism additions.** Timestamps stored as epoch-seconds integers; injectable clock in the token service; refresh tokens + sessions stored hashed/opaque; private signing keys stored as PKCS8 plaintext (documented dev-tool tradeoff); a fixed test signing key may be seeded for byte-reproducible JWKS/signatures in CI.
- **Rationale**: Keeps the six specs internally consistent and aligned with the locked architecture, and pre-empts the most common real-MSAL compatibility footguns (issuer matching, account identity).
- **Alternatives**: Per-feature ad-hoc stubbing (rejected — produces advertised-404s and ordering hazards); omit `client_info` and rely on OIDC-mode `sub` identity (rejected — fragile silent-token cache behavior in default MSAL mode); templated `{tenantid}` issuer (rejected — unnecessary complexity for a single tenant).

### Iteration 1 cross-cutting spec contracts (Batch B: features #7–#14)
- **Date**: 2026-06-22
- **Context**: Writing the Batch B Iteration-1 specs surfaced cross-cutting contract choices (refresh-token security, app-only authorization, Graph/admin/portal/run-target conventions) that build on Batch A's locked contracts and must stay consistent across the later features.
- **Decision**:
  1. **Refresh-token rotation + reuse detection (#7).** Every redemption rotates (revoke presented token, issue new one, `rotated_from` chain) inside **one atomic transaction** (compare-and-set on `revoked`), so concurrent redemptions never double-mint. Replaying an already-revoked token triggers **whole-family revocation** along the `rotated_from` chain reachable from the presented token (separate sign-ins are separate chains, preserved) and returns `invalid_grant` — reuse takes precedence over expiry. `getByHash` must return revoked/expired rows. Rolling TTL (fresh `TOKEN_LIFETIME_REFRESH_SECONDS` per rotation), no absolute family cap in MVP. ID token re-minted on refresh when `openid` granted; PKCE not re-checked on refresh; new `refresh_token` returned only when `offline_access` is in the (post-narrowing) grant.
  2. **Client-credentials app-role auto-grant (#8).** No app-role *assignment* table in MVP. App-only `roles` = all enabled `app_roles` on the resolved **resource** app whose `allowed_member_types` includes `Application` (empty `[]` for Graph/unknown resource). `.default` resource resolves to Graph (`GRAPH_RESOURCE_ID`), a registered app's `app_id_uri` (now enforced **unique** by #11), or its GUID `app_id`; else `invalid_scope`. Secret-only client auth. Documented divergence from Entra (which requires explicit application-permission assignment + admin consent), consistent with the locked auto-consent model.
  3. **UserInfo + logout (#9).** UserInfo (`/graph/oidc/userinfo`) requires a **delegated** Graph-audience token (has `oid`); app-only → `403 insufficient_scope`. `sub` returned equals the token `sub`. Logout validates `post_logout_redirect_uri` by exact match against the resolved app's **registered redirect URIs** (no separate post-logout-URI registry in MVP) and requires a resolvable `client_id`; otherwise renders a signed-out page. `id_token_hint` signature not enforced (hint only). Front-channel multi-RP logout is out of scope, so its discovery capability flags are not advertised (lockstep).
  4. **Minimal Graph authorization + Graph delegated-scope carve-out (#10, amends #5/#6).** Graph accepts the emulator's own `ver:"2.0"`, `aud=GRAPH_RESOURCE_ID` tokens (never Microsoft v1 shape). `/me` requires a delegated token; other reads accept delegated or app-only. **No fine-grained Graph scope/role enforcement in MVP** (a valid Graph-audience token suffices). **Amendment to Batch A #5/#6:** Microsoft Graph *delegated* scopes — the fully-qualified `<GRAPH_RESOURCE_ID>/<name>` form or a recognized bare short-name (`User.Read`, `User.Read.All`, `Group.Read.All`, ...) — are **auto-consented and accepted without registration**, set `aud=GRAPH_RESOURCE_ID`, and appear in `scp` by short name (so the canonical MSAL `scopes:['User.Read']`→`/me` quickstart works and is not rejected as `invalid_scope`). Graph-shaped JSON (`@odata.context`, `value[]`); offset paging via `$top`/`$skiptoken` with `@odata.nextLink` preserving the caller's query params.
  5. **Admin REST API conventions (#11, amends #2 seed/reset).** Unauthenticated (locked). Single admin error envelope `{ error: { code, message, target?, details? } }` with codes `validation_error|not_found|conflict|invalid_reference|internal_error`. Offset pagination (`top`/`skip`, response `{ value, count, top, skip }`) + `search` substring. Secrets are **show-once** (plaintext returned only at creation, hashed at rest, `hint` thereafter); passwords write-only (`hasPassword` boolean). Server generates all entity IDs. Non-null `app_id_uri` is **unique** (409 on duplicate). **Amendment to #2:** `seed.ts` exposes an idempotent skip-existing mode (`INSERT OR IGNORE`) used by `POST /admin/api/seed { force:true }` (non-destructive); `store.reset` **preserves the `tenants` row and active `signing_keys`** when `resetKeys=false` (required by `signing_keys.tenant_id` → `tenants.id` FK) and only empties runtime data tables.
  6. **Portal at `/`, MSAL snippet uses GUID authority (#12).** Portal SPA is served at the single-origin root `/` (overrides draft global-spec §9 `/admin`); consumes only the Admin API + `/health` + discovery. Generated MSAL snippet uses the GUID authority (`<origin>/<tenantId>`) + `knownAuthorities`. Visual styling blocked on `DESIGN.md` (undefined) — ships functional-but-unstyled (same blocker as #6's sign-in page).
  7. **Cross-platform MSAL recipe (#13).** Supported config for all four MSALs: GUID authority + `knownAuthorities`/`validateAuthority=false` + **instance discovery disabled** (offline). Microsoft cloud-host discovery fields stay omitted; `x5c` stays omitted from JWKS unless a platform validator demands it (contingency lands in #3). MSAL.NET/Python are smoke-tested in Iteration 1, fully sampled in Iteration 3. #13 establishes CI provisioning of the .NET SDK + Python runtime.
  8. **Run targets (#14).** Two Iteration-1 targets — `npm start` from source and Docker — share one config/data model. Docker base is Node ≥22.5 (target 24) for `node:sqlite`; a single named volume persists `data/` (DB + cert); container `HEALTHCHECK` hits `/health`. Single-executable is Iteration 2 (#17).
- **Rationale**: Keeps the eight Batch B specs internally consistent and aligned with Batch A's locked token/claim/error/path contracts, and pre-empts the highest-risk MSAL-compat footguns (refresh-rotation security, custom-authority/instance-discovery, issuer matching) while preserving the dev-tool simplicity (auto-consent/auto-grant, unauthenticated admin).
- **Alternatives**: Non-rotating or single-token-revocation refresh (rejected — weaker security, not MSAL-realistic); modeling app-role assignment + Graph permission enforcement in MVP (rejected — large surface for little MVP value, breaks the auto-consent token shape); separate post-logout-URI registry (rejected — reuse registered redirect URIs); adding Microsoft cloud-host discovery fields / `x5c` preemptively (rejected — would point at real hosts / unneeded by MSAL validators).

### Visual identity: Fluent-mimic, distinction carried by an amber "LOCAL EMULATOR" badge
- **Date**: 2026-06-22
- **Context**: The sign-in page (#6) and admin portal (#12) were blocked on `DESIGN.md` being `Status: undefined`; both shipped functional-but-unstyled pending a brand identity. The designer (Murdock) established the identity. The product's whole value is *familiarity* — MSAL developers should feel they're using the real Entra/Azure experience — which is in direct tension with the hard requirement to never impersonate Microsoft and to always read as a local sandbox.
- **Decision**: Commit to a single aesthetic direction — **Fluent-mimic**. White surfaces, restrained Fluent elevation, 4px default corners, a Segoe type voice, Azure communication-blue actions; the sign-in page mirrors the `login.microsoftonline.com` centered-card + account-picker pattern, and the portal mirrors the Azure shell (slim top bar + side nav + dense tables). The single, deliberate signal that this is **not** production is a persistent **amber "LOCAL EMULATOR" badge** (the caution color) in the portal top bar and on the sign-in card, plus a quiet "Not for production use" note. Distinction is carried by that badge + caution signalling, **not** by inventing a separate visual language. No Microsoft logos/trademarks used as our own; our own "Entra Local" wordmark. Captured in `DESIGN.md` (Overview/Positioning/Components — `badge-emulator`), validated `npx @google/design.md lint DESIGN.md` → 0 errors / 0 warnings.
- **Rationale**: Maximum muscle-memory transfer for the target developer while a single high-salience caution element removes any production/official-Microsoft ambiguity — the cheapest, clearest way to reconcile "feels like Entra" with "is obviously a sandbox."
- **Alternatives**: A distinct non-Microsoft visual language (rejected — sacrifices the familiarity that is the product's point); a faint/textual-only disclaimer (rejected — too easy to miss; the caution badge must be unmissable on every screen); replicating Microsoft branding 1:1 (rejected — trademark/impersonation risk, explicitly prohibited).

### Brand palette: Azure blue + Fluent teal + caution amber (+ Fluent semantics & grays)
- **Date**: 2026-06-22
- **Context**: Needed ≤5 color roles that read as Microsoft-adjacent Fluent while keeping the amber emulator signal legible and all pairings WCAG AA.
- **Decision**: Primary **Azure/Fluent communication blue `#0078D4`** (actions/links/active nav), accent **Fluent teal `#038387`** (highlights + the connected/local status dot), caution **amber `#F59E0B`** (the LOCAL EMULATOR badge + production-warning banners), plus Fluent semantics **success `#107C10`** / **error `#D13438`** and a full **Fluent neutral gray** ramp on white/`#FAF9F8` surfaces. AA was verified per pairing and **darker ramp steps are mandated where the base sits at the 4.5:1 edge**: blue links/text on white use `#106EBE` (5.26:1) not `#0078D4` (4.53:1); teal text uses `#015A5D` (8.01:1); and the amber **badge uses dark ink `#201F1E` (7.66:1) — never white-on-amber (2.15:1, fails)**.
- **Rationale**: These are the actual Fluent palette anchors, so the UI reads authentically Microsoft-adjacent rather than generic-blue-SaaS; amber is the conventional caution hue and gives the emulator signal a distinct, non-blue identity; the documented darker steps keep every text pairing AA-safe without abandoning the brand hues.
- **Alternatives**: A single-blue palette (rejected — no room for a distinct caution signal); red for the not-production warning (rejected — collides with the error/destructive semantic; amber = "caution/sandbox", red = "error"); generic Tailwind blue/indigo or a purple-gradient AI look (rejected — explicitly differentiated against).

### Typography: Segoe UI (system) → Selawik fallback, Cascadia Mono for identifiers (license-clean)
- **Date**: 2026-06-22
- **Context**: The Fluent-mimic look depends on the Segoe type voice, but Segoe UI cannot be embedded/redistributed as a webfont. Machine identifiers (GUIDs, client IDs, secrets, tokens, scopes) are pervasive in this tool and must be unambiguous and copyable.
- **Decision**: UI/body/display uses **`"Segoe UI"` referenced from the system stack only** (never embedded), with **Selawik** (Microsoft's OFL, Segoe-metric-compatible font, **self-hosted**) as the web fallback, then `system-ui, -apple-system, sans-serif`; Semibold 600 for titles/labels, Regular 400 for body. Monospace is **Cascadia Mono** (Microsoft, OFL, self-hosted), **required** for every identifier rendered as a copyable mono chip, and for code/MSAL snippets. Type scale + license note captured in `DESIGN.md` Typography.
- **Rationale**: Selawik reproduces Segoe's metrics/feel where Segoe is absent without redistributing a proprietary font, keeping the look license-clean; Cascadia Mono is the natural Microsoft-adjacent, OFL monospace and makes GUID/secret/scope values legible and unmistakably "machine values."
- **Alternatives**: Embedding a Segoe webfont (rejected — license violation); a generic system-font stack with no Selawik fallback (rejected — drifts off-metric on non-Windows, weakening the mimic); a generic mono like Roboto Mono/Consolas-only (rejected — Cascadia is the on-brand OFL choice).

### Brand references and artifacts
- **Date**: 2026-06-22
- **Context**: Recording what informed the identity and the reference artifacts produced for the coders building #6/#12.
- **Decision**: Direction informed by Microsoft **Fluent / Fluent 2** (color, elevation, shape, motion), the `login.microsoftonline.com` sign-in card + account-picker pattern, and the Azure/Entra admin-portal shell (pattern references only — no Microsoft assets used). Produced standalone HTML references under `brand/` (Tailwind CDN, DESIGN.md tokens wired through CSS variables): `brand/brand-book.html` (colors, ramps, AA pairings, badge + identifier-chip patterns), `brand/ui-kit.html` (buttons/fields/cards/table/badge/chip/banners/toast/top-bar/nav in their states), and `brand/demo.html` (the Fluent account-picker sign-in card with the amber badge and fake seed data). Motion is restrained Fluent (150–250ms, `cubic-bezier(0.1,0.9,0.2,1)`), light-mode only for the MVP.
- **Rationale**: The artifacts double as implementation references so #6/#12 styling matches `DESIGN.md` exactly, and they pin the patterns the prose describes.
- **Alternatives**: Prose-only identity with no artifacts (rejected — coders need concrete, runnable references to match pixels and states).

### TLS self-signed cert generation: `selfsigned` package (pure-Node fallback taken)
- **Date**: 2026-06-22
- **Context**: Feature #1 requires HTTPS-by-default with an auto-generated, persisted, stable self-signed cert (CN=localhost, SAN localhost/127.0.0.1/::1, RSA-2048). The spec preferred trying a pure-Node `node:crypto` X.509 self-sign first, with the `selfsigned` npm package as the approved fallback if pure-Node proved impractical.
- **Decision**: Use the `selfsigned` package to mint the self-signed cert/key (persisted under `TLS_CERT_DIR`, regenerated only if absent). `node:crypto` is still used for keypair-adjacent needs and for `X509Certificate` fingerprinting (SHA-256) in stability tests.
- **Rationale**: `node:crypto` can generate keypairs (`generateKeyPairSync`) but has **no API to build/sign an X.509 certificate** — a pure-Node self-sign would require hand-rolling ASN.1/DER encoding, which is brittle and out of scope for #1. `selfsigned` is small, dependency-light, and produces a standard cert with the required SANs; the cert is persisted so the fingerprint is stable across restarts (asserted by tests).
- **Alternatives**: Hand-rolled `node:crypto` ASN.1/DER X.509 self-sign (rejected — brittle, large effort, no upstream API); `node-forge` directly (rejected — `selfsigned` wraps it with a simpler, purpose-built API); shipping a checked-in dev cert (rejected — not per-install unique, and the spec mandates auto-generation).
