# Roadmap: Entra Local

## Goal
A local, MSAL-compatible emulator for Microsoft Entra ID so application developers can build
and test sign-in, token acquisition, and protected-API calls **offline, with no cloud
tenant** and no shared-tenant clutter. See [`specs/global-spec.md`](global-spec.md) for the
full specification.

## Audience
App developers, API developers, and QA/CI engineers building against Microsoft Entra ID
with MSAL.

## Execution Model (for autopilot agents)
This roadmap is built to be executed **feature-by-feature** by coding agents that verify
their own work along the way.

- **One feature at a time, in dependency order.** Don't start a feature until everything in
  its Dependencies column is ✅. Use the dependency column to pick the next ready feature.
- **Per-feature spec first.** Before coding a feature, a spec is written to
  `specs/<yyyy-mm-dd>_<feature>.md` capturing scope (in/out), endpoint/data contracts, and
  the feature's testable acceptance criteria. Implementation detail lives there, not here.
- **Feature #1 establishes the toolchain.** Project scaffolding, `npm` scripts
  (`dev`, `build`, `test`, `test:e2e`, `lint`, `typecheck`), the test harness, and CI land
  in feature #1 so every later feature can be verified the moment it is written.
- **Definition of Done (every feature):**
  1. Per-feature spec exists and is followed.
  2. `npm run lint`, `npm run typecheck`, and `npm run build` are green.
  3. Unit tests added and passing (`npm test`).
  4. Integration tests added for any new HTTP endpoint (request → response + persisted state).
  5. For auth-flow features (#6, #7, #8, #15), an end-to-end test drives the flow with a
     **real MSAL library** — inline test drivers (`msal-browser` headless + `msal-node`) that
     ship in feature #1's harness — against the running emulator, asserting JWKS-verifiable
     tokens. UserInfo and Logout (#9) are asserted within the Authorization Code e2e
     (sign-in → `/userinfo` → sign-out). The Iteration 3 sample apps are an *additional*
     regression surface, **not** a prerequisite for these earlier e2e tests.
  6. The feature's acceptance criteria (from its spec) are demonstrably met.
  7. Roadmap Status updated to ✅.
- **Determinism for CI.** Fixed tenant ID, fixed seed data, ephemeral DB file, and a fixed
  test port so runs are reproducible and parallel-safe.

See [`global-spec.md` §16 Testing & Verification Strategy](global-spec.md#16-testing--verification-strategy)
and [`memory/conventions.md`](../memory/conventions.md) for the concrete layout, commands,
and tooling.

## Iteration 1 (MVP)
**Outcome:** a developer registers an app and user in the portal, signs in from an MSAL app
via Authorization Code + PKCE (and uses Refresh Token / Client Credentials), and the issued
JWTs validate against JWKS *and* are consumable against the emulator's own UserInfo and
minimal Graph endpoints. Runs via `npm start` and Docker.

| # | Feature | Description | UI | Dependencies | Status |
|---|---------|-------------|----|--------------|--------|
| 1 | Server, config & TLS foundation + scaffolding | HTTPS server with auto self-signed cert, config loading/validation, health endpoint; project scaffold with npm scripts (`dev`/`build`/`test`/`test:e2e`/`lint`/`typecheck`), a unit+integration test harness, a real-MSAL e2e harness (incl. headless browser), and CI pipeline | – | – | ✅ |
| 2 | SQLite store, schema & seed | Repository layer, migrations, deterministic seed data | – | 1 | ✅ |
| 3 | Signing keys & JWKS endpoint | Persisted RSA key(s); `/discovery/v2.0/keys` so resource APIs verify tokens | – | 1, 2 | ✅ |
| 4 | OIDC discovery document | `.well-known/openid-configuration` driving MSAL auto-config | – | 1, 3 | ✅ |
| 5 | Token service | Mint/sign/validate ID & access JWTs; claims, lifetimes, code/refresh validation | – | 2, 3 | ✅ |
| 6 | Auth Code + PKCE + interactive sign-in | `/authorize` + `/token` (code grant) with account-picker sign-in page | ✓ | 4, 5 | ✅ |
| 7 | Refresh Token flow | Rotating refresh tokens for silent renewal (`offline_access`) | – | 6 | ✅ |
| 8 | Client Credentials flow | App-only tokens with `roles` for daemon/service apps | – | 5 | ✅ |
| 9 | UserInfo & Logout endpoints | OIDC `userinfo` + front-channel `logout` (advertised by discovery) | – | 5, 6 | ✅ |
| 10 | Minimal Microsoft Graph | Read `/me`, `/users`, `/groups` — proves the access-token mint→consume loop | – | 2, 5 | ✅ |
| 11 | Admin REST API | CRUD for users, groups, apps, secrets, scopes/roles; seed/reset | – | 2 | ✅ |
| 12 | Web portal | Dashboard, users, groups, app registrations, per-app MSAL config snippet | ✓ | 11 | ✅ |
| 13 | MSAL compatibility validation | Real-MSAL e2e for `msal-browser` & `msal-node` (sign-in / silent-refresh / sign-out) **plus** an authority/instance-discovery smoke-test for **MSAL.NET and MSAL Python**; provisions .NET + Python runtimes in CI; documents `protocolMode`/`knownAuthorities` per platform | – | 6, 7, 9 | ✅ |
| 14 | Run targets: `npm start` + Docker | Runnable from source and as a container with persisted volume | – | 1 | ✅ |

## Iteration 2
**Outcome:** complete the remaining flow, realism options, and zero-install distribution —
reaching the full v1.0 acceptance bar in [`global-spec.md` §15](global-spec.md#15-acceptance-criteria-v10-done).

| # | Feature | Description | UI | Dependencies | Status |
|---|---------|-------------|----|--------------|--------|
| 15 | Device Code flow | `/devicecode` + user-code approval page (RFC 8628) for CLI/device apps | ✓ | 5, 6 | ✅ |
| 16 | Optional password login enforcement | `REQUIRE_PASSWORD` username+password login instead of account picker | ✓ | 6 | ⬜ |
| 17 | Single-executable packaging | Self-contained binary bundling runtime, portal assets, migrations | – | 14 | ✅ |
| 25 | Trust-cert CLI command | `trust`/`untrust`/`cert-path`/`show-cert` subcommands to trust the dev cert (print by default, `--apply` to execute); exposed by the SEA binary | – | 1, 14, 17 | ✅ |
| 26 | Local domains (subdomains + wildcard cert + hosts CLI) | Serve the emulator under `*.entra.localhost` with `login.`/`portal.`/`graph.` subdomains on one `:8443` listener routed by `Host` header, a wildcard cert, and a cross-platform `hosts` CLI command; `localhost` stays a compat origin | ✓ | 1, 4, 10, 12, 25 | ⬜ |

## Iteration 3 — Sample applications
**Outcome:** minimal, runnable MSAL sample apps across the major platforms that authenticate
against the emulator out of the box. They double as living documentation and as an
**additional** regression surface for MSAL compatibility (feature #13) — they are *not* a
prerequisite for the Iteration 1-2 e2e tests, which use inline MSAL drivers from feature #1's
harness. All live under a top-level `samples/` folder, each with its own README and a
one-command run.

**Cross-sample conventions (per-feature specs `2026-06-25_18..21,24`):** each sample runs on its
**own port** with its **own seeded redirect URI**; every sample has a **README** covering config,
setup, the one-command run, app registration/port, cert trust, endpoint paths, troubleshooting, and
optional compose; certificate trust is documented in the **README only** (no helper scripts);
**every** sample gets a **CI build/smoke** step; and each sample ships an **optional
`docker-compose.yml`** that launches the emulator (`ghcr.io/cmaneu/entra-local`). Built-in Graph
calls use **Graph-audience** tokens (`User.Read` / `https://graph.microsoft.com/.default`); the
custom `api://.../access_as_user` audience pattern is demonstrated by the full-stack #24 Express
API. Because
deterministic app IDs can only come from seed data (the admin REST API server-generates `appId`),
the samples add a small set of **additive, fixed-GUID seed apps + per-port redirect URIs** to
`src/store/seed.ts` (the only server-side change — no protocol change). Feature **#18 owns** the
shared samples infrastructure (layout, port + app map, seed additions, CI smoke, compose) that the
other sample specs reference.

| # | Feature | Description | UI | Dependencies | Status |
|---|---------|-------------|----|--------------|--------|
| 18 | JS & React SPA samples | Vanilla `msal-browser` SPA + `msal-react` SPA doing Auth Code + PKCE (with silent renewal) | ✓ | 6, 7, 13 | ⬜ |
| 19 | Node samples (`msal-node`) | Confidential web app (auth code), daemon (client credentials), and a **Node.js CLI** (device code) | – | 6, 8, 13, 15 | ⬜ |
| 20 | .NET sample (MSAL.NET) | Console Auth Code sample (`dotnet run`); reuses the .NET toolchain/CI provisioned in #13 | – | 6, 13 | ⬜ |
| 21 | Python sample (MSAL Python) | Console Auth Code sample (`uv run`); reuses the Python toolchain/CI provisioned in #13 | – | 6, 13 | ⬜ |
| 24 | Full-stack SPA + protected API | JS SPA (`msal-browser`) calling a Node/**Express** resource API, **one app registration per tier** (front SPA app + back API app exposing a scope); the API validates the access token (JWKS/`iss`/`aud`/`scp`). Adds two fixed-GUID **seed** apps; no protocol change | ✓ | 3, 6, 7, 13, 18 | ✅ |

## Iteration 4 — Public developer documentation
**Outcome:** published, developer-facing documentation so external developers can adopt the
emulator without reading the internal specs. Docs reference the Iteration 3 samples and
assume Iterations 1-2 are ✅ (every documented endpoint and config option exists).

| # | Feature | Description | UI | Dependencies | Status |
|---|---------|-------------|----|--------------|--------|
| 22 | Getting started & MSAL integration guides | Install/run, trust the cert, and per-platform "point MSAL here" guides (JS, React, Node, .NET, Python) + the full-stack SPA→API walkthrough | ✓ | 18, 19, 20, 21, 24 | ⬜ |
| 23 | API, configuration & troubleshooting reference | Endpoint reference, config/env reference, claims reference, cert-trust troubleshooting, security disclaimer | – | 1, 4, 5, 6, 9, 10, 11, 15 | ⬜ |

## Deferred
| Feature | Rationale |
|---------|-----------|
| Multi-tenant directories | Single tenant covers MVP value; multi-tenant is a large surface-area increase (`tid` routing, isolation) |
| On-Behalf-Of (OBO) flow | Niche multi-tier API scenario; not needed to prove core value |
| Broader Graph (writes, app roles, directory objects) | Read surface (`/me`, `/users`, `/groups`) covers the common post-sign-in case |
| Certificate-based client auth (`private_key_jwt`) | Client-secret auth is sufficient for MVP |
| Signing-key rotation UI | Keys are persisted/stable; manual rotation is a polish feature |
| Consent screen / scope-consent modeling | Local dev tool auto-consents; consent UX adds friction without MVP value |
| Directory import/export (JSON fixtures) | Seed/reset covers reproducibility for now |

## Challenges & Mitigation
| Challenge | Mitigation |
|-----------|------------|
| MSAL custom-authority quirks (`knownAuthorities`, `protocolMode`, issuer matching); MSAL.NET/Python instance discovery may reject the authority | Feature #13 runs real-MSAL e2e for `msal-browser`/`msal-node` **and** an MSAL.NET + MSAL Python authority/instance-discovery smoke-test in CI; document required settings (`protocolMode`/`knownAuthorities`) per platform; pin discovery fields to MSAL expectations |
| Self-signed cert trust friction (MSAL/Node rejects untrusted certs) | Document trust steps; provide HTTP fallback toggle; persist cert for a stable fingerprint |
| Native SQLite in a single executable (native bindings) | Evaluate Node SEA vs `pkg` early; consider `node:sqlite`/`sql.js` fallback for the binary |
| Token/claims parity (`tid`, `oid`, `scp`, `roles`, `ver`) expected by MSAL and resource APIs | Derive claim set from real Entra tokens; add token-validation tests |
| Discovery doc advertising endpoints that 404 if flows are sequenced unevenly | Keep discovery in lockstep with implemented endpoints; UserInfo/Logout/Graph are in the MVP |

## Open Decisions
| Decision | Resolve by |
|----------|------------|
| Single-exe approach: Node SEA vs `pkg` | Before feature #17 |
| Documentation tooling: Docusaurus / VitePress / MkDocs vs plain Markdown | Feature #22 |
| Hosting for published docs (e.g. GitHub Pages) | Feature #22 |
| Exact OIDC discovery field set for cross-platform MSAL (.NET / Python) | Feature #13 |
| Project license (README says TBD) | Before feature #18 (samples bundle/redistribute MSAL libraries); also gates public release |

## Product Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| MVP scope vs global-spec acceptance bar | Device Code (#15) and single-executable (#17) sequenced to Iteration 2; everything else needed for sign-in + token + consume is in Iteration 1 | User chose a focused first ship; Device Code and binary packaging are completeness/distribution, not core to proving the MSAL sign-in loop. Global-spec §15 reconciled to mark those criteria as end-of-Iteration-2 |
| Refresh Token + Client Credentials in MVP | Included in Iteration 1 | Cheap to implement and commonly needed (silent renewal, daemon scenarios) |
| UserInfo, Logout & minimal Graph in MVP | Pulled into Iteration 1 (adversarial review finding) | Discovery advertises userinfo/logout endpoints; access tokens need an in-product consumer to prove value |
| MSAL compatibility as an explicit milestone | Added as feature #13 | MSAL compatibility is the project's #1 goal and highest delivery risk |
| Tenancy | Single tenant for MVP | Simplest mental model; multi-tenant deferred |
| Multi-language sample apps | Iteration 3 under `samples/`: JS (`msal-browser`), React (`msal-react`), Node (`msal-node` web + daemon + **CLI/device-code**), .NET (MSAL.NET), Python (MSAL Python) | Cover the platforms developers actually use; the Node CLI gives Device Code (#15) a living-doc sample. Samples double as living docs and as the real-MSAL e2e/regression fixtures for compatibility (feature #13) |
| Public developer documentation | Iteration 4 | Lowers adoption friction for external developers; sequenced after samples so docs can reference runnable examples |
| Autopilot-ready execution model | Feature #1 scaffolds the test/lint/build toolchain + CI; every feature carries a Definition of Done with unit/integration/e2e gates | Lets coding agents build and verify each feature incrementally without a human in the loop |
