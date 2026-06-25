# Feature #25 — Trust-cert CLI command

- **Roadmap ref:** Iteration 2 follow-up (developer experience). Complements
  [#1](2026-06-22_01-server-config-tls-foundation.md) (auto self-signed cert),
  [#14](2026-06-22_14-run-targets.md) (run targets), and [#17](2026-06-22_17-single-executable-packaging.md)
  (single-executable packaging — the binary must expose this command).
- **Dependencies:** [#1](2026-06-22_01-server-config-tls-foundation.md) (TLS material + `data/tls/cert.pem`),
  [#14](2026-06-22_14-run-targets.md), [#17](2026-06-22_17-single-executable-packaging.md).
- **Status:** ⬜ Not started.

> The emulator already serves HTTPS with an auto-generated, persisted self-signed certificate. Today
> a developer has to **find** `data/tls/cert.pem` and **remember the per-platform incantation** to
> trust it (or set `NODE_EXTRA_CA_CERTS`). This feature adds a first-party CLI so the emulator can
> tell the developer exactly what to run — or run it for them with `--apply`.

---

## Goal / outcome

A developer runs one command against the emulator (from source, Docker host, or the single-file
binary) to **trust the dev certificate** in their OS/browser trust store, **untrust** it, or **find**
it. By default the command is **non-destructive**: it resolves/generates the cert and **prints** the
exact platform command plus the `NODE_EXTRA_CA_CERTS` hint. Passing `--apply` executes the trust
command (which may prompt for elevation on some platforms). This is purely additive — it introduces a
CLI dispatch layer in front of the existing "boot the server" entrypoint and changes no server
behaviour, endpoint, schema, or config contract.

---

## Decision: print-by-default, opt-in `--apply`; manual argv parsing

- **Print by default, `--apply` to execute.** A dev tool should not silently mutate the user's
  machine trust store. The default prints the exact, copy-pasteable command (and the
  `NODE_EXTRA_CA_CERTS` env hint); `--apply` runs it via `execFileSync` (argument arrays, never a
  shell string — no injection surface).
- **Manual argv parsing, no new dependency.** The project keeps a lean 7-dependency runtime
  footprint. A small command table in `src/cli/` dispatches subcommands; anything that isn't a known
  subcommand falls through to the existing server boot, so `npm start` / Docker / the SEA binary keep
  working unchanged.
- **Scope note vs. samples.** `memory/conventions.md` keeps **sample** cert trust README-only (no
  helper scripts). This is a deliberately different surface: a **first-party emulator command** on the
  emulator binary itself. Recorded in `memory/decisions.md`.

---

## Scope

### In scope
- **CLI dispatch layer** (`src/cli/index.ts`): recognises the subcommands below as the first argv
  token; everything else (including no token) boots the server exactly as before. `src/index.ts` is
  refactored to call the dispatcher, extracting the current server-boot body into `startServer()`.
- **Subcommands:**
  - `trust` — resolve/generate the cert, then print (default) or `--apply` the platform trust
    command. `--remove` inverts it (alias `untrust`).
  - `untrust` — remove the cert from the trust store (print or `--apply`).
  - `cert-path` — print the absolute path to the cert clients must trust (generating it if needed).
  - `show-cert` — print the cert path and its SHA-256 fingerprint.
  - `help` / `--help` / `-h` — usage.
- **Per-platform trust commands** (argument arrays):
  - **Windows:** `certutil -addstore -user -f Root <cert>` / `-delstore -user Root <sha1-thumbprint>`
    (CurrentUser `Root` store — no admin).
  - **macOS:** `security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db <cert>`
    / `security remove-trusted-cert <cert>` (login keychain — no sudo).
  - **Linux/other:** system CA anchor (`/usr/local/share/ca-certificates/entra-local.crt` +
    `sudo update-ca-certificates`) **and** a best-effort browser **NSS** step
    (`certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n entra-local -i <cert>`, optional — needs
    `libnss3-tools`). The NSS step is marked optional and skipped on failure.
- **`NODE_EXTRA_CA_CERTS` hint** printed by `trust`/`untrust` regardless of platform (OS trust does
  not cover Node clients).
- **`resolveCertPath(config)` + `certThumbprint(certPem)`** helpers in `src/tls/cert.ts`, reusing the
  existing `resolveTlsMaterial()` so the cert is generated/persisted on first call.
- **SEA binary exposes the command.** Because the SEA entry is `dist/index.js`, the binary inherits
  every subcommand automatically (`entra-local trust`, `entra-local cert-path`, …). A `bin` field +
  shebang also expose it via `npx entra-local`.
- **README** "Certificate trust" section updated to document the command (from source, binary, and
  the Docker-host caveat).

### Out of scope
- Generating a local **CA** and issuing leaf certs (the cert stays a self-signed leaf — direct
  root-store trust is sufficient for `localhost`).
- Firefox's independent profile NSS stores beyond the shared `~/.pki/nssdb` best-effort step.
- Any change to server behaviour, endpoints, schema, the `npm start`/Docker targets, or the TLS
  config contract (`TLS_ENABLED`/`TLS_CERT`/`TLS_KEY`/`TLS_CERT_DIR`).
- Bundling/installing `mkcert` or other external tooling.

---

## Contracts

### `src/tls/cert.ts` (additions)
- `resolveCertPath(config: Config): string` — absolute path of the cert clients must trust. BYO cert
  → `resolve(config.tls.certPath)`. Auto cert → ensure generated via `resolveTlsMaterial(config)` then
  `join(resolve(config.tls.certDir), 'cert.pem')`. Throws if `tls.enabled === false`.
- `certThumbprint(certPem: string): string` — SHA-1 fingerprint without separators (used to match the
  cert for Windows `-delstore`).

### `src/cli/trust.ts`
- `type TrustAction = 'install' | 'remove'`.
- `interface TrustCommand { label; file; args; elevated; optional }`.
- `buildTrustPlan(action, certPath, thumbprint, plat): TrustCommand[]` — **pure**; the per-platform
  command list.
- `executePlan(action, certPath, plan, { apply, out, exec, plat })` — prints (default) or runs
  (`apply`) the plan; optional steps that fail are skipped, required failures throw `TrustError`;
  always prints the `NODE_EXTRA_CA_CERTS` hint. `exec`/`out`/`plat` are injectable for tests.
- `runTrust({ config, action, apply, out, exec, plat })` — resolves the cert (disk) then calls
  `executePlan`. `class TrustError extends Error`.

### `src/cli/index.ts`
- `isCliCommand(argv: string[]): boolean` — true iff `argv[2]` is a known subcommand.
- `runCli(argv: string[]): Promise<number>` — dispatches; returns a process exit code. Config errors
  (`ConfigError`), `TrustError`, and `resolveCertPath` errors print to stderr and return `1`.

### `src/index.ts`
- `startServer()` — the existing boot body (load config → `createServer` → log → signal handlers).
- entry: `if (isCliCommand(process.argv)) process.exit(await runCli(process.argv)); else startServer()`.

### `package.json`
- `"bin": { "entra-local": "dist/index.js" }` and a `#!/usr/bin/env node` shebang on `src/index.ts`
  (preserved by `tsc` and esbuild).

---

## Behavior / flow

```text
$ entra-local trust
Trust the Entra Local dev certificate
  cert: /abs/path/data/tls/cert.pem

Run the following to trust it, or re-run with --apply to execute automatically:

  # Trust in the CurrentUser Root store
  certutil -addstore -user -f Root "/abs/path/data/tls/cert.pem"

Node-based clients (they ignore the OS trust store) — point them at the cert:
  PowerShell:  $env:NODE_EXTRA_CA_CERTS = "/abs/path/data/tls/cert.pem"

$ entra-local trust --apply        # runs the command (may prompt for elevation)
$ entra-local untrust --apply      # removes it
$ entra-local cert-path            # /abs/path/data/tls/cert.pem
$ entra-local show-cert            # path + SHA-256 fingerprint
```

Docker caveat: inside a container the OS trust store is the container's, not the host's — the README
directs container users to copy the cert out (`docker cp …`) and run `trust` on the host.

---

## Dependencies & assumptions
- **Assumption:** trusting a self-signed **leaf** cert (CN=`localhost`, SANs `localhost`/`127.0.0.1`/`::1`)
  directly in the OS/NSS root store is accepted by browsers and OS TLS stacks for `localhost` — no
  separate CA is required.
- **Assumption:** `certutil` (Windows), `security` (macOS), and `update-ca-certificates` (Debian/Ubuntu)
  are present on their respective platforms; the Linux NSS step is **optional** and degrades to a
  printed instruction when `certutil`/`libnss3-tools` is absent.
- **Assumption:** `loadConfig()` performs no DB/network side effects, so the cert subcommands run
  without booting the store or server (confirmed — it only reads env/config + resolves TLS material).

---

## Testable acceptance criteria
1. **`cert-path`** prints the absolute cert path and, on first run against a fresh `TLS_CERT_DIR`,
   generates `cert.pem` (and `key.pem`) there.
2. **`show-cert`** prints the same path plus a SHA-256 fingerprint equal to `certFingerprint(cert.pem)`.
3. **`trust` (default)** prints the correct **platform** command (asserted per `win32`/`darwin`/`linux`
   via injected `plat`) and the `NODE_EXTRA_CA_CERTS` hint, and **does not** execute anything.
4. **`trust --apply`** invokes the injected `exec` with the exact `{file, args}` from the plan; an
   optional step whose `exec` throws is skipped without failing the command; a required step failure
   exits non-zero with a printed manual fallback.
5. **`untrust` / `trust --remove`** produce the inverse plan (remove/delete) on each platform.
6. **TLS disabled** (`TLS_ENABLED=false`): `cert-path`/`show-cert`/`trust` exit `1` with a clear
   "TLS is disabled — no certificate to trust" message (no stack trace).
7. **Server boot unchanged:** bare `node dist/index.js` (no subcommand) and an unknown token still
   start the server; existing TLS/run-target integration tests stay green.
8. **SEA binary exposes the command:** building the binary and running `entra-local cert-path`
   prints the cert path (asserted in the gated SEA smoke test, skips cleanly when the binary is absent).
9. **DoD:** `npm run lint`, `npm run typecheck`, `npm run build` green; unit tests for the plan
   builder + dispatcher and an integration test for `resolveCertPath`/print-mode added and passing;
   README "Certificate trust" section documents `trust`/`untrust`/`cert-path`/`show-cert` + `--apply`
   and the Docker caveat.

---

## Open questions
None blocking. *(Decisions: print-by-default with opt-in `--apply`; manual argv parsing — no new
dependency; self-signed leaf trusted directly (no local CA); Linux NSS step best-effort/optional;
first-party emulator command is intentionally distinct from the README-only **sample** cert-trust
convention — recorded in `memory/decisions.md`.)*
