# MSAL client configuration (per platform)

How to point each MSAL library at a running **Entra Local** emulator. The emulator is a custom
(non-Microsoft) authority, so the common thread across every platform is: **use the concrete-GUID
authority** and **disable instance discovery** (no egress to `login.microsoftonline.com`).

This is the canonical reference for feature **#13 (MSAL compatibility validation)** and the
Iteration 3 samples (#18–#22). It mirrors the configuration matrix in
`specs/2026-06-22_13-msal-compat-validation.md`, validated by the real-MSAL e2e suite
(`test/e2e/*.e2e.ts`) and the MSAL.NET / MSAL Python smoke-tests (`test/compat/`).

## Canonical values

- **Authority:** `<origin>/<tenantId>` — e.g. `https://localhost:8443/11111111-1111-1111-1111-111111111111`.
- **Tenant id:** `11111111-1111-1111-1111-111111111111` (fixed).
- **Discovery route:** `<origin>/<tenantId>/v2.0/.well-known/openid-configuration` (note the `/v2.0`).
- **Issuer (`iss`):** `<origin>/<tenantId>/v2.0` — a concrete GUID, **not** `{tenantid}`-templated.
- **JWKS:** RS256 keys published as `n`/`e`/`kid` (no `x5c`); signature verification works from those.
- **Cert trust:** the emulator serves a self-signed TLS cert (`<TLS_CERT_DIR>/cert.pem`); each client
  must trust it (per-platform below).

## Configuration matrix

| Platform | Authority | Key settings | Cert trust |
|---|---|---|---|
| `@azure/msal-browser` | `<origin>/<tenantId>` | `knownAuthorities: ['<host:port>']`; default AAD `protocolMode` (omit `protocolMode: 'OIDC'` — the emulator serves the AAD-layout `/v2.0/.well-known/...`). OIDC mode would require authority `<origin>/<tenantId>/v2.0`. | Browser trusts the cert (CI installs it / Playwright `ignoreHTTPSErrors`). |
| `@azure/msal-node` | `<origin>/<tenantId>` | `knownAuthorities: ['<host:port>']`; default AAD `protocolMode`. | `NODE_EXTRA_CA_CERTS=<cert.pem>` (or a custom `INetworkModule` passing `ca` — see `test/e2e/client-credentials.e2e.ts`). |
| MSAL.NET | `<origin>/<tenantId>` | `.WithAuthority(authority, validateAuthority: false)` + `.WithInstanceDiscovery(false)`. | `.WithHttpClientFactory(...)` whose `HttpClientHandler` pins the emulator `cert.pem` (test-only). |
| MSAL Python | `<origin>/<tenantId>` | `ConfidentialClientApplication(..., authority=<authority>, validate_authority=False, instance_discovery=False)`. | `REQUESTS_CA_BUNDLE=<cert.pem>` / `verify=<cert.pem>`. |

### Why these settings

MSAL's default behaviour probes `https://login.microsoftonline.com/common/discovery/instance`.
Pointing it at an offline custom authority requires **disabling instance discovery** and marking the
authority **known / unvalidated** so MSAL trusts the emulator's own discovery document. The single
fixed tenant returns a concrete-GUID issuer that every token's `iss` matches, so issuer validation
passes when the authority uses the GUID.

`x5c` is intentionally **omitted** from the JWKS — all four MSAL stacks verify RS256 from `n`/`e`/`kid`.
(If a future validator ever hard-requires `x5c`, the fix lives in the JWKS construction of feature #3.)

## Worked examples

The runnable references live in:

- `test/compat/dotnet/Program.cs` — MSAL.NET `ConfidentialClientApplication` →
  `AcquireTokenForClient` → JWT validation against the JWKS.
- `test/compat/python/smoke.py` — MSAL Python `ConfidentialClientApplication` →
  `acquire_token_for_client` → JWT validation with `pyjwt` + `cryptography`.
- `test/e2e/client-credentials.e2e.ts` — `@azure/msal-node` `acquireTokenByClientCredential`.
- `test/e2e/auth-code.e2e.ts`, `refresh-token.e2e.ts`, `userinfo-logout.e2e.ts` —
  `@azure/msal-browser` sign-in / silent refresh / sign-out.
