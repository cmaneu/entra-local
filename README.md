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

## Quick start

> Status: **specification phase.** The implementation is being built against
> [`specs/global-spec.md`](specs/global-spec.md). The commands below are the intended
> developer experience.

```bash
# From source
npm install
npm start
# Portal:    https://localhost:8443/admin
# Discovery: https://localhost:8443/{tenantId}/v2.0/.well-known/openid-configuration
```

```bash
# Docker (intended)
docker run -p 8443:8443 -v entra-local-data:/data entra-local
```

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
