# Conventions

<!-- Append new conventions at the end using this format:

### <Convention Name>
<Clear description with example if helpful>
-->

### Repository layout
Intended top-level shape (exact folder names finalized in feature #1's spec):
```
/                 README.md, DESIGN.md, package.json, specs/, memory/
specs/            roadmap.md, global-spec.md, per-feature specs <yyyy-mm-dd>_<feature>.md
memory/           decisions.md, conventions.md
src/              Emulator server (TypeScript)
  config/         Config loading & validation (zod)
  store/          SQLite repository layer, migrations, seed
  identity/       OIDC/OAuth2 endpoints (discovery, authorize, token, devicecode, logout, userinfo)
  tokens/         Signing keys, JWKS, JWT mint/validate
  graph/          Minimal Microsoft Graph endpoints
  admin/          Admin REST API
  http/           Server bootstrap, TLS, routing
portal/           React + TypeScript (Vite) admin portal
samples/          MSAL sample apps: js, react, node, dotnet, python (Iteration 3)
docs/             Public developer documentation (Iteration 4)
test/             Unit + integration tests (vitest)
test/e2e/         Real-MSAL end-to-end tests
```

### Language & runtime
Node.js LTS with TypeScript in `strict` mode, ES modules. The React portal is TypeScript + Vite.

### npm script contract
`dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e` (see global-spec §16.2). These names are stable so CI and agents can depend on them.

### Testing
Four layers — unit (vitest), integration (in-process HTTP), token-conformance (JWKS verification + Entra claim shapes), and real-MSAL end-to-end — per global-spec §16. Unit, integration, and token-conformance run under `npm test`; the real-MSAL e2e suite runs under `npm run test:e2e`. Every new HTTP endpoint requires an integration test; every new auth flow requires an e2e test driven by a real MSAL library. Tests must be deterministic: fixed tenant ID, fixed seed data, ephemeral DB file, fixed test port. The .NET and Python sample apps (Iteration 3) carry their own build/run/test wiring; CI provisions those runtimes (established with feature #13).

### Per-feature specs
Each roadmap feature gets a spec at `specs/<yyyy-mm-dd>_<feature>.md` before implementation, containing scope (in/out), contracts (endpoints, request/response, claims), data changes, and testable acceptance criteria. The roadmap stays product-level; the "how" lives in these specs.

### Definition of Done
A feature is done only when: its per-feature spec is satisfied; `lint`, `typecheck`, and `build` are green; unit + integration tests pass; e2e passes for flow features; the feature's acceptance criteria are met; and the roadmap Status is set to the complete marker.

### Commits
Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Append the trailer:
`Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`

### Determinism & secrets
Default tenant ID `11111111-1111-1111-1111-111111111111`; seed data uses fixed GUIDs. This is a development tool — never commit real secrets; seeded/known secrets are intentional and dev-only.

### Cross-platform MSAL compatibility (#13)
The MSAL client configuration for every platform is documented in `docs/msal-client-config.md`
(the canonical reference for samples #18–#22): authority = the concrete-GUID `<origin>/<tenantId>`,
instance discovery **disabled**, authority marked known/unvalidated, JWKS verified from `n`/`e`/`kid`
(no `x5c`). MSAL.NET and MSAL Python are validated by self-contained smoke-tests under `test/compat/`
(`dotnet/`, `python/smoke.py`) that perform a real client-credentials token acquisition and validate
the JWT; they are spawned as child processes by `test/e2e/msal-compat.e2e.ts` and **skip cleanly**
when their runtime/MSAL package is unavailable (never fail the suite). CI (`actions/setup-dotnet` +
`actions/setup-python` + `pip install msal pyjwt cryptography requests`) provisions both so they run
for real. `test/compat/` is excluded from the Docker image and its build artifacts are gitignored.

### Runtime asset access (#17)
The server reads exactly two non-code assets at runtime — the single-file portal
(`portal/dist/index.html`) and `package.json` (for the `/health` version). Always read them
through `src/runtime/assets.ts` (`readTextAsset(seaKey, () => new URL('…', import.meta.url))`),
never with a direct `readFileSync`/`fileURLToPath` at the call site. This keeps the normal run
targets (tsx/dev, `dist`, Docker) on their filesystem reads while the single-executable (Node
SEA) build transparently serves the same bytes from the embedded SEA blob. The URL must be
passed as a **lazy thunk** (esbuild empties `import.meta.url` in the CJS/SEA bundle, so eager
`new URL(..., import.meta.url)` would throw). New runtime-read assets must be added to BOTH the
`assets` map in `sea-config.json` and the relevant `readTextAsset` call. SEA outputs
(`dist-sea/`, `*.exe`, `*.blob`) are git/docker/prettier-ignored and never part of the Docker
image; `esbuild`/`postject` stay in devDependencies. Build per OS (`npm run build:sea`) — SEA
does not cross-compile; the dev binary is unsigned.

### Sample apps (`samples/`, Iteration 3 — specs `2026-06-25_18..21,24`)
All MSAL sample apps live under a top-level `samples/` folder, one subfolder per sample
(`js-spa/`, `react-spa/`, `node-web/`, `node-daemon/`, `node-cli/`, `dotnet-console/`,
`python-console/`, `fullstack-spa-api/{spa,api}/`). Conventions:

- **Standalone, not workspaces.** Each JS/Node sample is its own npm project (own
  `package.json`/lockfile); .NET/Python samples are self-contained (`dotnet` project /
  `pyproject.toml` + `uv`). `samples/**` build/dependency output (`node_modules`, `dist`, `bin`,
  `obj`, `.venv`, `__pycache__`) is git/prettier/docker-ignored and excluded from the server
  tsconfig/eslint — samples never enter the emulator build/lint/typecheck.
- **One-command run.** Each sample documents a single primary command with working defaults baked
  in (the seeded GUIDs + `https://localhost:8443`): npm (`npm run dev`/`npm start`) for JS/Node,
  `dotnet run` for .NET, `uv run` for Python. Emulator origin overridable via `EMULATOR_ORIGIN` /
  `VITE_EMULATOR_ORIGIN`.
- **Own port + seeded redirect.** Every sample runs on its own port with its own **seeded**
  redirect URI (loopback `http://localhost:<port>` — only the emulator is HTTPS). The canonical
  port + app-registration map is owned by spec #18.
- **Token audience matches protected API.** Samples that call the emulator's built-in Graph
  endpoints (`GET /graph/v1.0/me`, `/users`, `/groups`) request **Graph-audience** tokens
  (`User.Read` for delegated `/me`, `https://graph.microsoft.com/.default` for daemon reads).
  Tokens for custom `api://...` resources are not accepted by Graph; the custom-resource pattern is
  demonstrated by #24's Express API.
- **Seed-backed app IDs.** Deterministic app IDs come from `src/store/seed.ts` (the admin REST
  `POST /api/apps` server-generates `appId`). New fixed-GUID seed apps: `…0003` (confidential web,
  #19), `…0004` (full-stack SPA front, #24), `…0005` (full-stack API exposing `access_as_user`,
  #24); plus added per-port redirect URIs on `…0001`. Additions are additive/idempotent
  (`INSERT OR IGNORE`) with the seed integration test extended; no schema/protocol change. New
  dev-only GUIDs/secrets are added to the README seed/security list.
- **README completeness + README-only cert trust.** Each sample README documents what the sample
  demonstrates, prerequisites/setup, the one-command run, a full env-var/config table with defaults,
  the app registration + port used, exact endpoint paths, expected token claims, certificate trust,
  non-default emulator configuration, troubleshooting, and optional compose. `samples/README.md`
  indexes every sample. Cert trust stays README-only (`NODE_EXTRA_CA_CERTS`,
  `REQUESTS_CA_BUNDLE`, MSAL.NET in-process `HttpClientFactory` cert pin, browser trust store) — no
  helper scripts. CI asserts README files exist.
- **Required CI smoke.** A `samples` CI job builds and smoke-runs **every** sample against a
  freshly-seeded emulator. Browser/Node samples assert JWKS-verifiable tokens + successful protected
  calls. .NET/Python interactive console samples use explicit CI-safe `--smoke` modes that verify
  build/config, authority/discovery/JWKS/cert trust, and README presence without launching an
  external system browser. Reuses #13's runtime provisioning (.NET SDK, Python) plus
  `astral-sh/setup-uv`; smokes skip cleanly when a runtime is unavailable locally but are required
  in CI.
- **Optional emulator compose.** Each sample ships an optional `docker-compose.yml` that launches
  the emulator (`ghcr.io/cmaneu/entra-local:latest`, port 8443, named volume) so a developer can
  start the IdP with `docker compose up -d`; the sample itself still runs via its one-command
  script.
- **Separate-API-app pattern (#24).** The full-stack sample uses one app registration per tier:
  the SPA (`…0004`) requests `api://…0005/access_as_user`, so the access token's `aud` is the API
  app (`…0005`) and `scp` is `access_as_user`; the Express API validates with `jose`
  (`createRemoteJWKSet` + `jwtVerify`) against the JWKS, the concrete-GUID `iss`, `aud`, and `scp`.
  This works with no protocol change (per-app App ID URI + exposed scopes, `scopesAreValid`,
  `resolveAudience`).
- **CLI subcommands live in `src/cli/` behind the server boot (#25).** `src/index.ts` dispatches a
  recognised first argv token (`trust`/`untrust`/`cert-path`/`show-cert`/`help`) to
  `runCli`; anything else (incl. no token) boots the server via `startServer()`. New management
  commands go in `src/cli/` and return a process exit code (config/cert errors → stderr + exit 1).
  Subcommands are inherited by every run target — `npm start -- <cmd>`, the Docker image, and the
  SEA binary (entry `dist/index.js`) — plus `npx entra-local <cmd>` via the `bin` field. Unlike the
  README-only **sample** cert-trust convention, the emulator's own cert trust IS automated here via
  the `trust` command (print by default, `--apply` to execute; arg-array `execFileSync`, no shell).

### Package manager
The project uses **pnpm** (≥ 9) as its package manager. `pnpm-lock.yaml` is the committed
lockfile; `package-lock.json` is not used. Build scripts that invoke sub-scripts use `pnpm run
<script>`. The `pnpm-workspace.yaml` at the repo root holds pnpm-level config (currently:
`allowBuilds` for esbuild). Sample apps under `samples/` are standalone npm projects and are
explicitly excluded from the pnpm workspace — they keep their own `package-lock.json` and use npm.
