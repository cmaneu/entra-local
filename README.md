# Entra Local

**A local emulator for Microsoft Entra ID (formerly Azure AD), built for application developers.**

Entra Local exposes the same OpenID Connect / OAuth 2.0 endpoints that **MSAL** talks to —
plus a minimal Microsoft Graph surface and a web portal to register users and applications.
Point your app's `authority` at the emulator and develop sign-in, token acquisition, and
protected-API calls **offline, with no cloud tenant, and no shared-tenant clutter**.

> ⚠️ **Development tool only.** Entra Local is intentionally insecure for the sake of
> developer ergonomics (open admin portal, self-signed certs, seeded secrets). Never use it
> in production or expose it to untrusted networks.

---

## Why?

Testing against a real Entra ID tenant is slow and heavyweight: it needs cloud access and
admin consent, clutters shared tenants with throwaway app registrations, and can't run
offline or deterministically in CI. Entra Local is a drop-in identity provider that speaks
the same protocols, so your MSAL-based app works against it with only configuration changes.

## Features (MVP)

- 🔐 **MSAL-compatible OIDC/OAuth2 endpoints** — discovery, JWKS, authorize, token,
  device code, logout, userinfo.
- 🎫 **Supported flows** — Authorization Code + PKCE, Client Credentials, Refresh Token,
  Device Code.
- 🪪 **Real RS256-signed JWTs** — ID and access tokens validatable against a working JWKS
  endpoint.
- 👥 **Minimal Microsoft Graph** — read `/me`, `/users`, `/groups`.
- 🖥️ **Web portal** — register users, groups, and app registrations; copy ready-to-paste
  MSAL config snippets.
- 💾 **SQLite persistence** — state survives restarts; deterministic seed data for CI.
- 🔒 **HTTPS by default** — auto-generated, persisted self-signed certificate.
- 📦 **Run anywhere** — `npm start`, a single executable, or a Docker container.

> Out of scope for the MVP: multi-tenant directories, Implicit flow, ROPC, OBO, SAML /
> WS-Federation, MFA, Conditional Access, and full Graph parity. See the
> [roadmap](specs/roadmap.md).

## How it works

```text
   Your app (MSAL)                         Entra Local (single process)
  ┌───────────────┐   authority =        ┌──────────────────────────────┐
  │  SPA / Web /  │   https://localhost: │  OIDC / OAuth2 endpoints      │
  │ Daemon / CLI  │──────8443/{tenant}──▶│  Minimal Graph (/me /users)   │
  └───────────────┘                      │  Admin REST API + Portal      │
         ▲                               │  Token service (RS256)        │
         │  validate JWT via JWKS        │  SQLite data store            │
  ┌──────┴────────┐                      └──────────────────────────────┘
  │  Resource API │◀──────── JWKS ───────────────────┘
  └───────────────┘
```

## Running the emulator

Entra Local runs two ways with **identical behavior and one config/data model** — the only
difference is where the persisted `data/` directory lives (host working directory vs. a Docker
volume). Both serve HTTPS on `8443` by default, auto-generate and persist a self-signed
certificate, and seed a deterministic directory on first boot.

### 1. From source (`npm start`)

```bash
npm install      # install dependencies
npm run build    # compile the server (dist/) + build the admin portal (single-file)
npm start        # run the built server: node dist/index.js
# Portal:    https://localhost:8443/
# Health:    https://localhost:8443/health        -> {"status":"ok", ...}
# Discovery: https://localhost:8443/{tenantId}/v2.0/.well-known/openid-configuration
```

`npm start` runs the **built** server, so run `npm run build` first (a guard aborts with a
clear message if `dist/` or the portal bundle is missing). State (the SQLite DB at `DB_PATH`
and the TLS cert/key under `TLS_CERT_DIR`) persists under `./data/` and survives restarts.
For an auto-reloading dev loop instead, use `npm run dev`.

### 2. Docker

```bash
docker build -t entra-local .
docker run -p 8443:8443 -v entra-local-data:/app/data entra-local
# equivalently: npm run docker:build && npm run docker:run
```

The image is a hardened multi-stage build (Node 24 base for the built-in `node:sqlite`
driver), runs as a **non-root** user, and ships only the runtime (compiled server + prebuilt
portal asset + production dependencies — no React/Vite/test toolchain). It declares a
`HEALTHCHECK` that polls `/health` over TLS and a `VOLUME` at `/app/data`.

- **Persistence:** mount a named volume at **`/app/data`** so the SQLite DB and the
  auto-generated cert (stable fingerprint) survive `docker stop`/`docker start` and upgrades.
- **Port mapping:** the container binds `HOST=0.0.0.0` internally (so the published port is
  reachable from the host) while issuer/origin still default to `https://localhost:8443`. Map
  it with `-p 8443:8443` (or `-p <hostPort>:8443`).
- **Config passthrough:** every config key is read from the environment — for example:

  ```bash
  docker run -p 9000:9000 \
    -e PORT=9000 \
    -e TENANT_ID=11111111-1111-1111-1111-111111111111 \
    -e REQUIRE_PASSWORD=true \
    -v entra-local-data:/app/data entra-local
  ```

- **Fronted differently?** If clients reach the emulator at something other than
  `https://localhost:8443` (a different host/port, or behind a proxy), set `PUBLIC_ORIGIN`
  (and optionally `ISSUER`) so discovery/JWKS/token URLs and the token `iss` match what
  clients actually use — e.g. `-e PUBLIC_ORIGIN=https://entra.localtest.me:8443`.

> ⚠️ The container binds `0.0.0.0` for host port mapping. This is fine for an **isolated local
> container**, but Entra Local is a dev tool with seeded secrets and an open admin API — never
> publish it on an untrusted network or the public internet.

### 3. Single-file binary (Node SEA)

Build a **self-contained native executable** that boots the full emulator with **no Node
install, no `npm install`, and no external files** — the compiled server, all production
dependencies, the admin portal, and the version metadata are bundled/embedded into one binary
(built with [Node Single Executable Applications](https://nodejs.org/api/single-executable-applications.html)).
Persistence uses the built-in `node:sqlite`, so there are **no native bindings** to ship.

```bash
npm run build       # compile the server + the single-file portal (prerequisite)
npm run build:sea   # bundle (esbuild) -> embed assets -> inject the SEA blob (postject)
# -> dist-sea/entra-local       (Linux/macOS)
# -> dist-sea/entra-local.exe   (Windows)
```

Run it like any other binary; it reads the **same** env/config keys as `npm start` and writes
the **same** `data/` layout (SQLite DB + auto-generated TLS cert) relative to its working
directory:

```bash
# Linux/macOS
./dist-sea/entra-local
# Windows (PowerShell)
.\dist-sea\entra-local.exe
# override config via env, e.g.:
#   PORT=9000 TENANT_ID=11111111-1111-1111-1111-111111111111 ./dist-sea/entra-local
```

- **Data & cert:** like the other targets, the binary creates `./data/entra-local.db` and a
  persisted self-signed cert under `./data/tls/` on first run (override with `DB_PATH` /
  `TLS_CERT_DIR`).
- **Supported platforms:** Windows, Linux, and macOS (x64/arm64). SEA does **not**
  cross-compile — build the binary **on the OS you intend to run it on**. The binary embeds the
  Node runtime used to build it (must be **≥ 22.5** for `node:sqlite`).
- **Unsigned (dev only):** the produced binary is **not code-signed**, so Windows SmartScreen /
  macOS Gatekeeper may warn on first run (and `postject` prints a benign
  "signature seems corrupted" notice on Windows because it invalidates Node's original
  signature). This is a developer tool — do not redistribute the unsigned binary as a trusted
  release.
- **Smoke-test it:** `npm run test:sea` builds the binary and runs an automated check that it
  boots over HTTPS, serves `/health` (with the embedded version), the portal at `/`, and OIDC
  discovery. The same test also runs (gated on the binary existing) in `npm test`.

### Certificate trust

The emulator serves HTTPS with an auto-generated, persisted **self-signed** certificate
(CN=`localhost`, SANs for `localhost`/`127.0.0.1`/`::1`), so clients must trust it or relax
verification **in dev only**:

- **Trust it (recommended):** import the cert into your OS/browser trust store. From source it
  is `./data/tls/cert.pem`; from a container, copy it out with
  `docker cp <container>:/app/data/tls/cert.pem ./cert.pem`.
- **Bypass it (dev only):** point your client's CA at that `cert.pem`, or set
  `NODE_TLS_REJECT_UNAUTHORIZED=0` for a Node client / `curl --insecure` for quick checks.
  Never disable verification for anything but local development.
- **Bring your own cert:** set `TLS_CERT` + `TLS_KEY` to use a custom pair (both or neither).

### Point MSAL at the emulator

```jsonc
// Example (@azure/msal-browser) — generated per app in the portal
{
  "auth": {
    "clientId": "<appId from the portal>",
    "authority": "https://localhost:8443/11111111-1111-1111-1111-111111111111",
    "knownAuthorities": ["localhost:8443"],
    "redirectUri": "https://localhost:3000"
  }
}
```

Trust the emulator's self-signed certificate (or relax cert validation in dev) so MSAL can
fetch the discovery document and JWKS over HTTPS.

## Development

The toolchain and project layout are established by roadmap feature #1
([spec](specs/2026-06-22_01-server-config-tls-foundation.md)). Node **22.5+** is required
(the persistence layer uses the built-in `node:sqlite`).

```bash
npm install        # install dependencies
npm run dev        # run the server with reload (tsx watch)
npm run build      # type-check + emit server to dist/ (+ portal placeholder)
npm run typecheck  # tsc --noEmit across server + tests
npm run lint       # eslint + prettier --check
npm test           # unit + integration tests (vitest, in-process, deterministic)
npm run test:e2e   # real-MSAL end-to-end suite (starts a real HTTPS server)
npm start          # run the built server (node dist/index.js)
```

Configuration is loaded from environment variables → `entra-local.config.json` → built-in
defaults (highest precedence first) and validated on startup; see
[`.env.example`](.env.example) and
[`entra-local.config.example.json`](entra-local.config.example.json) for the full reference.
Invalid config aborts startup with a non-zero exit naming the offending key.

Source layout: `src/` (server) with `config/` (zod validation), `tls/` (cert generation),
`http/` (routing, path map, error handling); `test/` (`unit/`, `integration/`, `e2e/`,
`helpers/`); `portal/` (admin portal, built in #12). Runtime state (SQLite DB + the persisted
self-signed cert) lives under `data/` (gitignored).

> **Browser e2e (`@azure/msal-browser` via Playwright)** is wired in the harness but gated
> behind `E2E_BROWSER=1` until the interactive sign-in flow lands (#6), so `npm run test:e2e`
> is green without a browser download.

## Documentation

- 🗺️ **[Roadmap](specs/roadmap.md)** — iterations, MVP cut, dependencies, and deferred work.
- 📋 **[Global specification](specs/global-spec.md)** — goals, architecture, API surface,
  token design, data model, configuration, deployment, and acceptance criteria.
- 🧠 **[Decisions](memory/decisions.md)** / **[Conventions](memory/conventions.md)** —
  project memory.

## Project status & roadmap

Entra Local is in early design. The current focus is **Iteration 1 (MVP)** in the
[roadmap](specs/roadmap.md): the core Authorization Code + PKCE sign-in loop (plus Refresh
Token and Client Credentials), UserInfo/Logout, minimal Graph, the admin portal, and
`npm start` + Docker. Iteration 2 adds Device Code, optional password login, and
single-executable packaging. Multi-tenant, OBO, broader Graph, and cert-based client auth
are deferred.

## Security & seed data

Entra Local is a **development tool**, not a secure identity provider. It ships a deterministic,
fixed-GUID seed directory so flows are reproducible in CI:

- Default tenant `11111111-1111-1111-1111-111111111111` (`Entra Local`).
- Users `alice@entralocal.dev` and `bob@entralocal.dev` (both members of the `Engineering` group),
  with the known dev password `Password1!`.
- A public SPA app (`cccccccc-…-0001`, redirect `https://localhost:3000`, scope `access_as_user`)
  and a confidential daemon app (`cccccccc-…-0002`, app role `Tasks.Read.All`) whose client secret
  is the known dev value `daemon-app-secret`.

These credentials are **intentionally public and dev-only**. Passwords and app secrets are stored
hashed (scrypt) at rest, and refresh tokens are stored hashed (SHA-256) — but signing keys are
persisted unencrypted for a stable `kid`. Never point a real application or real secrets at this
emulator, and never expose it beyond localhost. Reset to a clean seed at any time via the store
reset routine (admin endpoint lands in a later feature).

## Disclaimer

Entra Local is an independent developer tool and is **not** affiliated with, endorsed by, or
supported by Microsoft. "Microsoft Entra ID", "Azure AD", "Microsoft Graph", and "MSAL" are
trademarks of Microsoft. This project emulates publicly documented protocol behavior for
local development and testing only.

## License

To be determined.
