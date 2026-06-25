# Entra Local — Samples

Runnable MSAL sample applications that authenticate against the local
[Entra Local](../README.md) emulator. Each sample is a **standalone project** (its own
`package.json` / lockfile) and is **not** part of the root build — install and run it from its own
folder.

All samples assume the emulator is running on `https://localhost:8443` with its seeded demo
directory. From the repo root:

```bash
npm install && npm run build && npm start
```

Seeded users (dev-only credentials): `alice@entralocal.dev` / `bob@entralocal.dev`, password
`Password1!`.

## Available samples

| Sample                                                   | Stack                                  | What it demonstrates                                                                 |
| -------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| [`fullstack-spa-api/`](./fullstack-spa-api/README.md)    | `@azure/msal-browser` SPA + Express API | A SPA (app `…0004`) acquiring a delegated token **for a separate API app** (`…0005`) and the API validating it — the canonical "SPA → protected API" flow, one app registration per tier. |

> More samples (vanilla/React SPA, Node web/daemon/CLI, .NET console, Python console) are specified
> under [`../specs/`](../specs/) and will land alongside this one.

## Conventions

- Each sample runs on **its own port** with its own registered redirect URI (see each README).
- **Certificate trust** is documented per sample (no helper scripts) — typically
  `NODE_EXTRA_CA_CERTS` for Node tiers.
- Samples that call the built-in **Microsoft Graph** endpoints request Graph-audience scopes
  (`User.Read`, `https://graph.microsoft.com/.default`); only the full-stack sample uses a custom
  `api://…/access_as_user` scope, because its own API validates that audience.
- Each sample ships an **optional `docker-compose.yml`** that launches only the emulator.
