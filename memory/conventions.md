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
