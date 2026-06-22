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
