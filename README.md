<div align="center">

<img src="assets/entra-local-logo.svg" alt="Entra Local" width="520" />

# Entra Local

**A local, MSAL-compatible emulator of Microsoft Entra ID (formerly Azure AD), for application developers.**

</div>

Entra Local exposes the same OpenID Connect / OAuth 2.0 endpoints that **MSAL** talks to —
plus a minimal Microsoft Graph surface and a web portal to register users and applications.
Point your app's `authority` at the emulator and develop sign-in, token acquisition, and
protected-API calls **offline, with no cloud tenant, and no shared-tenant clutter**.

> [!CAUTION]
> **Local development tool only — intentionally insecure, and a partial emulation.** Entra Local
> trades security for developer ergonomics: an **open, unauthenticated** admin portal and API,
> **self-signed** certificates, **publicly known seeded** users and secrets, and signing keys
> stored unencrypted on disk. It emulates only a **small, fixed slice** of Entra ID. **Run it on
> `localhost` only** — never put real users, passwords, or secrets into it, and never expose it to
> an untrusted network or the public internet. See
> [What it emulates](#what-it-emulates--and-what-it-doesnt) and
> [Security & limitations](#security--limitations).

---

## Why?

Testing against a real Entra ID tenant is slow and heavyweight: it needs cloud access and
admin consent, clutters shared tenants with throwaway app registrations, and can't run
offline or deterministically in CI. Entra Local is a drop-in identity provider that speaks
the same protocols, so your MSAL-based app works against it with only configuration changes.

## Features

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

## What it emulates — and what it doesn't

Entra Local deliberately emulates a **small, well-defined slice** of Entra ID: the protocol
surface MSAL needs for the most common developer scenarios. Treat anything not listed under
**Supported** as **unsupported** — if your app depends on it, validate against a real tenant.

### ✅ Supported

**Developer scenarios**

- **SPA** — Authorization Code + PKCE (public client).
- **Web app** — Authorization Code with a confidential client secret.
- **Daemon / service** — Client Credentials (app-only token with app roles).
- **CLI / device** — Device Code flow (RFC 8628).
- **Token refresh** — rotating refresh tokens.
- **Protected API + minimal Graph** — call `/me`, `/users`, `/groups` with the access token.

**Protocol surface**

- OIDC discovery (`.well-known/openid-configuration`) and JWKS.
- `authorize`, `token`, `devicecode`, `userinfo`, and front-channel `logout`.
- Real RS256-signed ID and access tokens, verifiable against the JWKS endpoint.
- Minimal Microsoft Graph: read-only `/me`, `/users`, `/groups`.
- Admin REST API + web portal to manage users, groups, and app registrations.

### ❌ Not emulated

- Multiple / real directories — a **single fixed tenant** only.
- Implicit flow and ROPC (resource-owner password grant).
- On-Behalf-Of (OBO), SAML 2.0, and WS-Federation.
- MFA, Conditional Access, Identity Protection, and consent prompts (apps are **auto-consented**).
- Certificate / `private_key_jwt` client authentication (client **secrets** only).
- Full Microsoft Graph (writes and most resources) and advanced claims/token policies.

See the [roadmap](specs/roadmap.md) for what may land in later iterations.

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

Entra Local runs several ways with **identical behavior and one config/data model** — the only
difference is where the persisted `data/` directory lives (a Docker volume vs. the host working
directory). The quickest start is the **prebuilt Docker image**; you can also run from source or
as a single-file binary. Every target serves HTTPS on `8443` by default, auto-generates and
persists a self-signed certificate, and seeds a deterministic directory on first boot.

### 1. Docker (recommended)

Pull and run the prebuilt image from the GitHub Container Registry — no clone, no toolchain:

```bash
docker pull ghcr.io/cmaneu/entra-local
docker run -p 8443:8443 -v entra-local-data:/app/data ghcr.io/cmaneu/entra-local
# Portal:    https://localhost:8443/
# Health:    https://localhost:8443/health        -> {"status":"ok", ...}
# Discovery: https://localhost:8443/{tenantId}/v2.0/.well-known/openid-configuration
```

The image is a hardened multi-stage build (Node 24 base for the built-in `node:sqlite`
driver), runs as a **non-root** user, and ships only the runtime (compiled server + prebuilt
portal asset + production dependencies — no React/Vite/test toolchain). It declares a
`HEALTHCHECK` that polls `/health` over TLS and a `VOLUME` at `/app/data`. `:latest` tracks the
newest full release; pin a specific version with `ghcr.io/cmaneu/entra-local:<version>`.

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
    -v entra-local-data:/app/data ghcr.io/cmaneu/entra-local
  ```

- **Fronted differently?** If clients reach the emulator at something other than
  `https://localhost:8443` (a different host/port, or behind a proxy), set `PUBLIC_ORIGIN`
  (and optionally `ISSUER`) so discovery/JWKS/token URLs and the token `iss` match what
  clients actually use — e.g. `-e PUBLIC_ORIGIN=https://entra.localtest.me:8443`.

#### Docker Compose

Drop this into a `docker-compose.yml` next to your project and run `docker compose up`:

```yaml
services:
  entra-local:
    image: ghcr.io/cmaneu/entra-local:latest
    ports:
      - '8443:8443'
    volumes:
      - entra-local-data:/app/data
    # Optional: override any config key via the environment.
    # environment:
    #   PUBLIC_ORIGIN: https://entra.localtest.me:8443
    #   TENANT_ID: 11111111-1111-1111-1111-111111111111
    #   REQUIRE_PASSWORD: 'true'

volumes:
  entra-local-data:
```

> ⚠️ The container binds `0.0.0.0` for host port mapping. This is fine for an **isolated local
> container**, but Entra Local is a dev tool with seeded secrets and an open admin API — never
> publish it on an untrusted network or the public internet.

> 🛠️ **Contributors** can build the image locally instead of pulling it:
> `docker build -t entra-local .` (or `pnpm run docker:build && pnpm run docker:run`).

### 2. Kubernetes (Helm)

Deploy Entra Local into Kubernetes with the OCI Helm chart published to GitHub Packages:

```bash
helm upgrade --install entra-local \
  oci://ghcr.io/cmaneu/entra-local-helm/entra-local \
  --version 0.1.0
```

The chart is documented in [deployment/helm/README.md](deployment/helm/README.md). It exposes
values for the image, replica count, service, ingress, resources, environment variables, and
scheduling options.

### 3. From source (`pnpm start`)

```bash
pnpm install     # install dependencies
pnpm run build   # compile the server (dist/) + build the admin portal (single-file)
pnpm start       # run the built server: node dist/index.js
# Portal:    https://localhost:8443/
# Health:    https://localhost:8443/health        -> {"status":"ok", ...}
# Discovery: https://localhost:8443/{tenantId}/v2.0/.well-known/openid-configuration
```

`pnpm start` runs the **built** server, so run `pnpm run build` first (a guard aborts with a
clear message if `dist/` or the portal bundle is missing). State (the SQLite DB at `DB_PATH`
and the TLS cert/key under `TLS_CERT_DIR`) persists under `./data/` and survives restarts.
For an auto-reloading dev loop instead, use `pnpm run dev`.

### 4. Single-file binary (Node SEA)

Build a **self-contained native executable** that boots the full emulator with **no Node
install, no `npm install`, and no external files** — the compiled server, all production
dependencies, the admin portal, and the version metadata are bundled/embedded into one binary
(built with [Node Single Executable Applications](https://nodejs.org/api/single-executable-applications.html)).
Persistence uses the built-in `node:sqlite`, so there are **no native bindings** to ship.

```bash
pnpm run build       # compile the server + the single-file portal (prerequisite)
pnpm run build:sea   # bundle (esbuild) -> embed assets -> inject the SEA blob (postject)
# -> dist-sea/entra-local       (Linux/macOS)
# -> dist-sea/entra-local.exe   (Windows)
```

Run it like any other binary; it reads the **same** env/config keys as `pnpm start` and writes
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
- **Smoke-test it:** `pnpm run test:sea` builds the binary and runs an automated check that it
  boots over HTTPS, serves `/health` (with the embedded version), the portal at `/`, and OIDC
  discovery. The same test also runs (gated on the binary existing) in `pnpm test`.

### Published releases

Publishing a GitHub Release runs the [`Release` workflow](.github/workflows/release.yml), which
re-runs the full lint/typecheck/build/test gate and then publishes the distributable artifacts:

- **Single-file binaries** — built per OS (Node SEA does not cross-compile), smoke-tested, and
  attached to the Release as `entra-local-linux-x64`, `entra-local-windows-x64.exe`, and
  `entra-local-macos-arm64`.
- **Docker image** — pushed to the GitHub Container Registry (part of GitHub Packages) at
  `ghcr.io/cmaneu/entra-local`, tagged with the release version (and `latest` for a full,
  non-prerelease Release):

  ```bash
  docker run -p 8443:8443 -v entra-local-data:/app/data ghcr.io/cmaneu/entra-local:latest
  ```

The Release tag is stamped into the artifacts at build time, so the running build reports that
exact version at `/health` — and the portal surfaces it in the top-bar health chip and the
Dashboard "Version" card.

### Certificate trust

The emulator serves HTTPS with an auto-generated, persisted **self-signed** certificate
(CN=`localhost`, SANs for `localhost`/`127.0.0.1`/`::1`), so clients must trust it or relax
verification **in dev only**:

- **Trust it with the built-in command (recommended):** the emulator can tell you exactly what to
  run for your OS — or run it for you:

  ```bash
  pnpm start -- trust            # print the platform trust command + NODE_EXTRA_CA_CERTS hint
  pnpm start -- trust --apply    # actually trust it (may prompt for elevation)
  pnpm start -- untrust --apply  # remove it from the trust store
  pnpm start -- cert-path        # print the path to cert.pem
  pnpm start -- show-cert        # print the path + SHA-256 fingerprint
  ```

  From the single-file binary the same subcommands work directly (`entra-local trust`,
  `entra-local cert-path`, …). By default `trust` only **prints** the command; `--apply` executes it.
- **Trust it manually:** import the cert into your OS/browser trust store. From source it
  is `./data/tls/cert.pem`; from a container, copy it out with
  `docker cp <container>:/app/data/tls/cert.pem ./cert.pem`, then run `trust --apply` (or your OS's
  import step) **on the host** — a container's trust store is not your host's.
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
([spec](specs/2026-06-22_01-server-config-tls-foundation.md)). Node **22.13+** and
**[pnpm](https://pnpm.io/) ≥ 9** are required (the persistence layer uses the built-in
`node:sqlite`).

```bash
pnpm install        # install dependencies
pnpm run dev        # run the server with reload (tsx watch)
pnpm run build      # type-check + emit server to dist/ (+ portal placeholder)
pnpm run typecheck  # tsc --noEmit across server + tests
pnpm run lint       # eslint + prettier --check
pnpm test           # unit + integration tests (vitest, in-process, deterministic)
pnpm run test:e2e   # real-MSAL end-to-end suite (starts a real HTTPS server)
pnpm start          # run the built server (node dist/index.js)
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

> **Browser e2e (`@azure/msal-browser` via Playwright)** is opt-in behind `E2E_BROWSER=1`, so
> `pnpm run test:e2e` stays green without a browser download. Set it to exercise the real
> interactive sign-in loop end-to-end in a headless browser.

## Documentation

- 🗺️ **[Roadmap](specs/roadmap.md)** — iterations, MVP cut, dependencies, and deferred work.
- 📋 **[Global specification](specs/global-spec.md)** — goals, architecture, API surface,
  token design, data model, configuration, deployment, and acceptance criteria.
- 🤝 **[Contributing](CONTRIBUTING.md)** — how to propose changes (open an issue first) and the
  project's governance.
- 🧠 **[Decisions](memory/decisions.md)** / **[Conventions](memory/conventions.md)** —
  project memory.

## Project status & roadmap

**Iteration 1 (MVP) is complete** and verified end-to-end against real MSAL clients:
Authorization Code + PKCE sign-in, Client Credentials, Refresh Token, **Device Code**
(RFC 8628), UserInfo/Logout, minimal Graph, the admin REST API + web portal, and all three
run targets (`npm start`, Docker, and the single-file binary). Remaining work tracked in the
[roadmap](specs/roadmap.md): optional password-login enforcement, MSAL sample apps
(JS / React / Node CLI / .NET / Python), and a public developer-documentation pass.
Multi-tenant, OBO, broader Graph, and certificate-based client auth remain deferred.

## Security & limitations

Entra Local is a **development tool**, not a secure identity provider. It is **insecure by
design** so it stays easy to run and reset:

- **No authentication on the admin surface** — the portal and the `/admin/api/...` REST API are
  fully open to anyone who can reach the port.
- **Publicly known, seeded credentials** — fixed users, passwords, and app secrets ship in the
  source (listed below) so flows are reproducible in CI.
- **Self-signed TLS** — a certificate you must explicitly trust or bypass, in dev only.
- **Signing keys stored unencrypted** on disk, to keep a stable `kid` across restarts.
- **No MFA, Conditional Access, consent, rate limiting, or audit** — the sign-in page even
  warns end users not to type a real password.
- **A single, auto-consented directory** — every registered app is implicitly trusted.

**Run it on `localhost` only.** Never point a real application or real secrets at it, and never
expose it beyond your machine or an isolated local container.

### Seed data

It ships a deterministic, fixed-GUID seed directory so flows are reproducible in CI:

- Default tenant `11111111-1111-1111-1111-111111111111` (`Entra Local`).
- Users `alice@entralocal.dev` and `bob@entralocal.dev` (both members of the `Engineering` group),
  with the known dev password `Password1!`.
- A public SPA app (`cccccccc-…-0001`, redirect `https://localhost:3000`, scope `access_as_user`)
  and a confidential daemon app (`cccccccc-…-0002`, app role `Tasks.Read.All`) whose client secret
  is the known dev value `daemon-app-secret`.

These credentials are **intentionally public and dev-only**. Passwords and app secrets are stored
hashed (scrypt) at rest, and refresh tokens and device codes are stored hashed (SHA-256) — but
signing keys are persisted unencrypted for a stable `kid`. Reset to a clean seed at any time from
the portal or the admin REST API (`/admin/api/...`).

## Disclaimer

Entra Local is an independent developer tool and is **not** affiliated with, endorsed by, or
supported by Microsoft. "Microsoft Entra ID", "Azure AD", "Microsoft Graph", and "MSAL" are
trademarks of Microsoft. This project emulates publicly documented protocol behavior for
local development and testing only.

## License

[MIT](LICENSE) © Christopher Maneu & Entra Local contributors.
