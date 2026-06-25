# Feature #26 — Local domains (subdomain hosts + wildcard cert + hosts CLI)

- **Roadmap ref:** Iteration 2 follow-up (developer experience). Builds on
  [#1](2026-06-22_01-server-config-tls-foundation.md) (server/config/TLS foundation),
  [#4](2026-06-22_04-oidc-discovery.md) (discovery URL derivation),
  [#10](2026-06-22_10-minimal-graph.md) (Graph), [#12](2026-06-22_12-web-portal.md) (portal),
  and [#25](2026-06-25_25-trust-cert-cli.md) (cert CLI — this feature adds a sibling `hosts`
  command and a wildcard cert).
- **Dependencies:** #1 (config + TLS material), #4 (metadata), #10 (Graph `@odata`), #12
  (portal), #25 (CLI dispatch layer in `src/cli/`).
- **Status:** ⬜ Not started.

> Today the emulator serves a **single origin** (`https://localhost:8443`) and splits its
> surfaces by **path prefix** (`/{tenant}/...`, `/graph`, `/admin`, SPA at `/`), with cert SANs
> hardcoded to `localhost`/`127.0.0.1`/`::1`. Real Entra separates the STS
> (`login.microsoftonline.com`), Graph (`graph.microsoft.com`), and portal onto distinct hosts.
> This feature introduces an opinionated, faithful **local-domains** experience under
> `entra.localhost` with three subdomains, a **wildcard certificate**, and a cross-platform
> **hosts-file CLI** — without giving up the "one process, one port, one cert" simplicity.

---

## Goal / outcome

A developer points MSAL at `https://login.entra.localhost:8443/<tenant>`, opens the portal at
`https://portal.entra.localhost:8443/`, and calls Graph at `https://graph.entra.localhost:8443`.
One wildcard cert (`*.entra.localhost`) covers all three. `entra-local hosts --apply` writes the
hosts-file entries that point the names at `127.0.0.1`. Plain `localhost`/`127.0.0.1` keeps
working as a backward-compatible origin that serves every route, so the Docker healthcheck,
existing tests, samples, and the real-MSAL e2e suite stay green.

---

## Decisions

- **`entra.localhost` is the new default base domain.** Subdomain origins become the default
  advertised URLs (issuer, discovery, Graph base, portal). Recorded in `memory/decisions.md`.
- **One shared HTTPS listener on `:8443`, routed by the `Host` header.** All three names resolve
  to `127.0.0.1:8443` behind one wildcard leaf cert — no extra ports, processes, or certs. This
  refines #1's single-origin path-map decision (host separation is layered *on top of* the same
  listener; the path map is unchanged within each host).
- **`localhost`/`127.0.0.1` is a compat origin serving all routes.** Host separation is additive;
  the legacy single-origin behavior is preserved for any non-subdomain host (incl. the apex and
  unknown hosts), keeping Docker/tests/samples/e2e working.
- **Wildcard leaf cert, regenerated on SAN drift.** `*.entra.localhost` + apex + `localhost`/
  `127.0.0.1`/`::1` + `LOCAL_DOMAINS`. No local CA (consistent with #25's leaf-trust decision).
- **`userinfo` moves to the Graph host.** Mirrors real `graph.microsoft.com/oidc/userinfo`; the
  path stays `/oidc/userinfo`. Discovery advertises `userinfo_endpoint` on the Graph origin.
- **Trust stays manual.** The existing `trust` command is unchanged; the new `hosts` command is
  **print-by-default, `--apply` to execute** (same ergonomics; never auto-applied).

---

## Scope

### In scope

- **Config (`src/config`):**
  - `BASE_DOMAIN` (default `entra.localhost`); `LOCAL_DOMAINS` (comma-separated extra apex
    domains, applied to both cert SANs and hosts entries).
  - Derived, individually-overridable origins: `loginOrigin` / `portalOrigin` / `graphOrigin`
    (`${scheme}://{login|portal|graph}.${baseDomain}:${port}`), env overrides `LOGIN_ORIGIN` /
    `PORTAL_ORIGIN` / `GRAPH_ORIGIN`.
  - `issuer = ${loginOrigin}/${tenantId}/v2.0` (honor explicit `ISSUER`).
  - **Back-compat:** when `PUBLIC_ORIGIN` is set, all three origins collapse to it (legacy
    single-origin). `HOST`/`PORT` remain **bind-only** (Docker keeps `0.0.0.0`).
- **Host routing (`src/http`):**
  - `hostRole(hostHeader, config): 'login' | 'portal' | 'graph' | 'compat'`.
  - An `onRequest` guard that returns JSON 404 for a path whose slice is not allowed on the
    request host (`compat` allows all). Routes remain globally registered.
  - Host-aware SPA fallback: portal HTML on `portal`/`compat`; `login`/`graph` root → a small
    JSON descriptor.
- **Per-host URL derivation:** `src/identity/metadata.ts` (login origins; `userinfo_endpoint` on
  Graph origin); `src/graph/handlers.ts` (`@odata.context` / `@odata.nextLink` on Graph origin);
  replace remaining `config.publicOrigin` reads.
- **TLS (`src/tls/cert.ts`):** compute the SAN set (apex + `*.entra.localhost` + localhost set +
  `LOCAL_DOMAINS` + their wildcards), CN `entra.localhost`; regenerate the persisted cert when
  its SANs don't cover the configured set (parse X509 SANs); stable fingerprint otherwise.
- **Hosts CLI (`src/cli/hosts.ts`, wired in `src/cli/index.ts`):** `hosts` (print) /
  `hosts --apply` / `hosts --remove [--apply]`. Cross-platform hosts path, elevation note,
  idempotent `# entra-local BEGIN/END` block mapping every subdomain (+ `LOCAL_DOMAINS`) to
  `127.0.0.1`. Added to `help`. Inherited by npm/Docker/SEA.
- **`/health` origins:** additive `origins: { login, portal, graph }` so the portal + tooling can
  discover the advertised origins.
- **Portal (`portal/src`):** `EmulatorContext` fetches discovery from `origins.login` (absolute,
  cross-origin; CORS already reflects origin + credentials). `msalSnippet` derives authority /
  `knownAuthorities` from the login issuer and `graphBase` from the Graph origin.
- **Startup logging:** log the three advertised origins + a hint to run `hosts --apply` when the
  names don't resolve.
- **Docs / samples / memory:** README, `.env.example`, `entra-local.config.example.json`,
  `docs/msal-client-config.md`, `samples/**` authConfig + READMEs; append a decision +
  convention.

### Out of scope

- Auto-trusting the cert (kept manual via `trust`).
- A local **CA** or per-leaf issuance (single wildcard leaf is sufficient).
- Multi-tenant host routing, real DNS, or non-loopback exposure.
- Changing the **bind** model (still loopback by default; Docker `0.0.0.0`), the run targets, or
  the redirect-URI matching rules (sample redirect URIs stay loopback `http://localhost:<port>`).

---

## Contracts

### `src/config/schema.ts`
- New raw keys: `baseDomain`, `localDomains?` (string[] after split), `loginOrigin?`,
  `portalOrigin?`, `graphOrigin?`.
- `Config` gains `baseDomain: string`, `localDomains: string[]`, and
  `origins: { login: string; portal: string; graph: string }`. `publicOrigin` retained (equals
  `origins.login` unless `PUBLIC_ORIGIN`/`LOGIN_ORIGIN` override). `assembleConfig` derives the
  three origins (override → `PUBLIC_ORIGIN` collapse → `BASE_DOMAIN` default) and `issuer` from
  `origins.login`.

### `src/http/hostRouting.ts` (new)
- `hostRole(hostHeader: string | undefined, config: Config): HostRole`.
- `enforceHostRouting(app)` — `onRequest` hook returning `sendJsonNotFound` for cross-slice paths
  on a typed host; `compat` is unrestricted. Reuses the `pathmap` slice classifier.

### `src/tls/cert.ts`
- `buildSanList(config): { dns: string[]; ip: string[] }` — pure SAN derivation.
- `certCoversDomains(certPem, dns): boolean` — X509 SAN coverage check (wildcard-aware).
- `resolveTlsMaterial` regenerates when the persisted cert fails `certCoversDomains`.

### `src/cli/hosts.ts`
- `interface HostsEntry { ip: string; host: string }`; `hostsEntries(config): HostsEntry[]`.
- `hostsFilePath(plat): string`; `buildHostsBlock(entries): string` (BEGIN/END marker block).
- `runHosts({ config, action: 'add' | 'remove', apply, out, plat, fs })` — print (default) or
  write the idempotent block; prints the elevation/path note. Injectable `fs`/`out`/`plat`.

### `src/cli/index.ts`
- Add `hosts`/`unhosts` to the known subcommands + dispatch + `help`.

### `src/http/plugins.ts` (`/health`)
- `HealthResponse` gains `origins: { login: string; portal: string; graph: string }`.

---

## Behavior / flow

```text
$ entra-local hosts
Map the Entra Local local domains to 127.0.0.1
  hosts file: C:\Windows\System32\drivers\etc\hosts   (needs Administrator)

Add the following block (or re-run with --apply to write it):

  # entra-local BEGIN
  127.0.0.1  login.entra.localhost
  127.0.0.1  portal.entra.localhost
  127.0.0.1  graph.entra.localhost
  # entra-local END

$ sudo entra-local hosts --apply       # writes/updates the block (idempotent)
$ entra-local hosts --remove --apply   # removes the block
```

```text
Host header               → serves
login.entra.localhost     → discovery, jwks, authorize, token, devicecode, logout
graph.entra.localhost     → /v1.0/* Graph, /oidc/userinfo
portal.entra.localhost    → portal SPA, /admin/api/*, /health
localhost | 127.0.0.1     → ALL of the above (compat)
```

---

## Dependencies & assumptions

- **`*.localhost` does not reliably auto-resolve** (notably on Windows), so explicit hosts
  entries are required; the `hosts` command provides them. (`localhost` itself always resolves,
  which is why the compat origin keeps CI/e2e working with no hosts changes.)
- **A wildcard leaf cert trusted directly** (no CA) is accepted by browsers/OS TLS for these
  loopback names — consistent with #25.
- **e2e/CI stays on the compat `localhost` origin** (subdomains won't resolve in CI without hosts
  entries); subdomain routing is verified via **injected `Host` headers** in integration tests.
- `loadConfig()` remains side-effect-free, so `hosts` runs without booting the store/server.

---

## Testable acceptance criteria

1. **Default origins:** with no overrides, `config.origins.login` =
   `https://login.entra.localhost:8443`, `issuer` =
   `https://login.entra.localhost:8443/<tenant>/v2.0`, Graph base =
   `https://graph.entra.localhost:8443`, portal = `https://portal.entra.localhost:8443`.
2. **Back-compat collapse:** `PUBLIC_ORIGIN=https://localhost:8443` collapses all three origins +
   issuer to that origin (legacy behavior); per-subdomain overrides win over it.
3. **Wildcard cert:** a freshly generated cert's SANs include `entra.localhost`,
   `*.entra.localhost`, `localhost`, `127.0.0.1`, `::1` (+ any `LOCAL_DOMAINS`); changing the
   configured domain set regenerates the persisted cert, an unchanged set does not.
4. **Host routing (injected `Host`):** `login.` serves discovery/token and 404s `/admin/api` +
   `/graph/v1.0/*`; `graph.` serves `/v1.0/*` + `/oidc/userinfo` and 404s OIDC + admin; `portal.`
   serves the SPA + `/admin/api` + `/health` and 404s OIDC + Graph; `localhost` serves all.
5. **Discovery / Graph URLs:** discovery advertises login-origin endpoints with
   `userinfo_endpoint` on the Graph origin; Graph `@odata.context`/`nextLink` use the Graph
   origin.
6. **`/health` origins:** the response includes `origins.{login,portal,graph}` matching config.
7. **Hosts CLI:** `hosts` prints the correct platform path + the BEGIN/END block for all
   subdomains (+ `LOCAL_DOMAINS`); `--apply` writes an **idempotent** block (re-apply is a no-op,
   `--remove` deletes it); asserted per `win32`/`darwin`/`linux` via injected `plat`/`fs`.
8. **Portal:** the MSAL snippet authority/`knownAuthorities` use `login.entra.localhost:8443`, the
   Graph base uses `graph.entra.localhost:8443`; the portal loads discovery from the login origin.
9. **e2e unaffected:** the real-MSAL suites keep passing on the compat origin (no hosts entries
   needed).
10. **DoD:** `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` green; unit +
    integration tests above added; README + `.env.example` + config example +
    `docs/msal-client-config.md` + samples updated; decision + convention recorded; roadmap
    Status set to ✅.

---

## Open questions

None blocking. *(Decisions: subdomains under `entra.localhost` as the new default; one port +
Host-header routing; `localhost` compat origin serves all; wildcard leaf cert regenerated on SAN
drift; `userinfo` on the Graph host; manual trust + print-by-default `hosts` command. Minor
build-time choices: per-subdomain override precedence over `PUBLIC_ORIGIN`; `login`/`graph` root
returns a small JSON descriptor.)*
