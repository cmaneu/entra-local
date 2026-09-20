# Entra Local — Samples

Runnable MSAL sample applications that authenticate against the local
[Entra Local](../README.md) emulator. Each sample is a **standalone project** (its own
`package.json` / lockfile) and is **not** part of the root build — install and run it from its own
folder.

All samples assume the emulator is running on `https://localhost:8443` with its seeded demo
directory. From the repo root:

```bash
npm install && npm run build
# The samples target the loopback compat origin, so advertise that origin (see the note below):
PUBLIC_ORIGIN=https://localhost:8443 npm start        # bash/zsh
# $env:PUBLIC_ORIGIN='https://localhost:8443'; npm start   # PowerShell
```

Seeded users (dev-only credentials): `alice@entralocal.dev` / `bob@entralocal.dev`, password
`Password1!`.

> **Local domains (#26):** by default the emulator advertises `login.`/`portal.`/
> `graph.entra.localhost` and **mints tokens with the `login.` subdomain issuer**. These samples
> deliberately target the **`localhost` backward-compat origin** (`EMULATOR_ORIGIN`/authority =
> `https://localhost:8443`), so start the emulator with **`PUBLIC_ORIGIN=https://localhost:8443`** to
> collapse every surface — issuer, authorize, token, Graph — back onto `localhost`. That keeps them
> running with **no hosts-file changes**. (Without it, MSAL is redirected to the non-resolving
> subdomains and the API's `iss` check rejects the token.) To exercise the subdomains instead, run
> `entra-local hosts --apply` and split each sample's origin per surface (login for `authority`,
> graph for Graph calls).

## Available samples

| Sample                                                   | Stack                                  | What it demonstrates                                                                 |
| -------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| [`node-cli/`](./node-cli/README.md)                      | `@azure/msal-node` console app          | The **Device Authorization Grant** (RFC 8628) for a browserless CLI: a public client (app `…0001`) prints a code, you approve in a browser, and it calls Microsoft Graph `/me`. |
| [`dotnet-console/`](./dotnet-console/README.md)         | MSAL.NET console app                   | The **Authorization Code + PKCE** flow with system browser sign-in and **form_post response mode** (RFC 8693): a public client (app `…0001`) signs in, acquires a Graph-audience access token, and calls Microsoft Graph `/me`. |
| [`fullstack-spa-api/`](./fullstack-spa-api/README.md)    | `@azure/msal-browser` SPA + Express API | A SPA (app `…0004`) acquiring a delegated token **for a separate API app** (`…0005`) and the API validating it — the canonical "SPA → protected API" flow, one app registration per tier. |
| [`obo-spa-api/`](./obo-spa-api/README.md)                | `@azure/msal-browser` + Express + `@azure/msal-node` | A three-tier SPA (`…0008`) → confidential API (`…0009`) → local Graph `/me` **On-Behalf-Of** flow with user identity continuity. |

> More samples (vanilla/React SPA, Node web/daemon, Python console) are specified
> under [`../specs/`](../specs/) and will land alongside these.

## Token configuration (optional claims & group claims)

Both samples surface **optional claims** and **group claims**. See
[`../docs/token-configuration.md`](../docs/token-configuration.md) for the full reference (supported
claims, ID-token vs access-token ownership, group overage, decoded token examples, and portal
steps).

Two dedicated demo app registrations are seeded for this:

| App                | `appId`                                | Demonstrates |
| ------------------ | -------------------------------------- | ------------ |
| `local-web-client` | `cccccccc-0000-0000-0000-000000000006` | **Optional ID-token claims** (`email`, `upn`, `given_name`, `family_name`, `groups`) + security-group claims, configured on the **client** app. |
| `local-api`        | `cccccccc-0000-0000-0000-000000000007` | **Optional access-token claims** (`email`, `upn`, `groups`) + group claims, configured on the **resource/API** app. |

Sign in as **`bob@entralocal.dev`** (2 groups) to see an inline `groups` array, or
**`alice@entralocal.dev`** (4 groups) to trigger **group overage** — the token then carries an
overage pointer and the app resolves membership via `GET /graph/v1.0/me/memberOf`. Both demo apps use
a deliberately small overage limit (`3`).

## Conventions

- Each sample runs on **its own port** with its own registered redirect URI (see each README).
- **Certificate trust** is documented per sample (no helper scripts) — typically
  `NODE_EXTRA_CA_CERTS` for Node tiers.
- Samples that call the built-in **Microsoft Graph** endpoints request Graph-audience scopes
  (`User.Read`, `https://graph.microsoft.com/.default`); the full-stack and OBO samples use custom
  `api://…/access_as_user` scopes because their APIs validate those audiences.
- Each sample ships an **optional `docker-compose.yml`** that launches only the emulator.
