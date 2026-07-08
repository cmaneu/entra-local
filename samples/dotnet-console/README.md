# Entra Local .NET Console Sample

An MSAL.NET interactive authentication sample that demonstrates signing in against the **Entra Local** emulator, acquiring a Graph-audience access token, and calling Microsoft Graph's `/me` endpoint.

## What it demonstrates

- **MSAL.NET PublicClientApplication** configuration against a custom authority (Entra Local emulator)
- **Authorization Code + PKCE** flow via system browser  
- **Loopback redirect** (`http://localhost:3003`) for receiving the authorization code
- **form_post response mode** (RFC 8693) — security-preferred response delivery via auto-submitted HTML form
- **JWT token claim extraction** — parsing and displaying `iss`, `aud`, `scp`, `oid`
- **Microsoft Graph integration** — calling `/graph/v1.0/me` with the acquired access token
- **Emulator cert trust** — test-only in-process certificate pinning (no global OS trust mutation)
- **CI-safe smoke mode** — verifies MSAL configuration and emulator connectivity without launching a browser

## Prerequisites

1. **.NET 8 SDK** — [Download](https://dotnet.microsoft.com/en-us/download/dotnet/8.0)
2. **Entra Local emulator** running on `https://localhost:8443`:
   ```bash
   cd /path/to/entra-local
   PUBLIC_ORIGIN=https://localhost:8443 npm start
   ```
3. **Seeded demo directory** — the emulator is initialized with test users:
   - Username: `alice@entralocal.dev`
   - Password: `Password1!`

## Running locally

### Interactive sign-in

```bash
dotnet run
```

This will:
1. Print the MSAL configuration
2. Open your system browser to sign in
3. After sign-in, acquire an access token
4. Call `GET /graph/v1.0/me` and print the user's profile
5. Display token claims (`iss`, `aud`, `scp`, `oid`)

**Example output:**
```
MSAL Configuration:
  Authority:     https://localhost:8443/11111111-1111-1111-1111-111111111111
  Client ID:     cccccccc-0000-0000-0000-000000000001
  API Scope:     https://graph.microsoft.com/.default
  Redirect URI:  http://localhost:3003
  Cert (trusted): /path/to/entra-local/data/tls/cert.pem

Starting interactive authentication...
A browser window will open for sign-in.

✓ Token acquired successfully

Access Token Claims:
  iss: https://localhost:8443/11111111-1111-1111-1111-111111111111/v2.0
  aud: https://graph.microsoft.com
  scp: User.Read
  oid: aaaaaaaa-0000-0000-0000-000000000001

Calling GET https://localhost:8443/graph/v1.0/me...
✓ Graph /me call successful

User Profile:
  displayName: Alice
  mail: alice@entralocal.dev

✓ Sample completed successfully!
```

### Smoke mode (CI-safe)

```bash
dotnet run -- --smoke
```

This runs all verification steps **without** launching a system browser:
- Verifies emulator discovery endpoint is reachable
- Verifies JWKS endpoint is accessible  
- Confirms `form_post` response mode is supported
- Validates MSAL client configuration
- Exits cleanly for CI pipelines

**Example smoke output:**
```
Running smoke mode (CI-safe verification)...

Verifying emulator discovery...
✓ Discovery endpoint reachable
Verifying JWKS endpoint...
✓ JWKS endpoint reachable

MSAL Configuration:
  Client ID:        cccccccc-0000-0000-0000-000000000001
  Authority:        https://localhost:8443/11111111-1111-1111-1111-111111111111
  API Scope:        https://graph.microsoft.com/.default
  Redirect URI:     http://localhost:3003
  Response Mode:    form_post

Verifying response modes...
✓ form_post response mode is supported

✓ Smoke mode verification passed!
```

## Running in Docker

The sample includes a **`Dockerfile`** and **`docker-compose.yml`** that run both the emulator and the .NET console app in containers.

### Prerequisites

- **Docker** and **Docker Compose**

### Run end-to-end

```bash
docker-compose up --build
```

This will:

1. **Build** the .NET console image
2. **Start the emulator** service (`https://emulator:8443`)
3. **Wait** for the emulator to be healthy
4. **Download** the emulator's certificate
5. **Run the console app** in smoke mode (automated, no browser)
6. **Display results** — token claims and Graph `/me` response
7. **Exit** cleanly

**Example Docker output:**
```
dotnet-console-sample  | === Entra Local .NET Console Sample ===
dotnet-console-sample  | Emulator origin: https://emulator:8443
dotnet-console-sample  | Tenant ID: 11111111-1111-1111-1111-111111111111
dotnet-console-sample  | Enable smoke mode: true
dotnet-console-sample  |
dotnet-console-sample  | Waiting for emulator to be ready...
dotnet-console-sample  | ✓ Emulator is ready
dotnet-console-sample  | ✓ Certificate found at /cert/emulator-cert.pem
dotnet-console-sample  |
dotnet-console-sample  | Starting .NET console sample...
dotnet-console-sample  | ---
dotnet-console-sample  | 
dotnet-console-sample  | Running smoke mode (CI-safe verification)...
dotnet-console-sample  | ✓ Smoke mode verification passed!
```

### Access the emulator admin portal

While the compose services are running, open the admin portal in another terminal:

```bash
# The portal runs on host port 5173
open https://localhost:5173
```

(Requires trusting the emulator's self-signed certificate.)

### Run interactively (with browser)

To run the sample interactively inside Docker (system browser sign-in), override the smoke mode:

```bash
ENABLE_SMOKE=false docker-compose up --build
```

This will:
1. Start the emulator
2. Expose port `3003` for the loopback redirect
3. Launch the console app in interactive mode
4. Print a message to open your browser to sign in
5. **Note:** The system browser is on the **host**, not in the container, so the sample will open your host browser

### Customize Docker setup

Override environment variables in the compose file or via command-line:

```bash
# Change the emulator origin or client ID
EMULATOR_ORIGIN=https://custom-origin:8443 \
CLIENT_ID=other-client-id \
docker-compose up --build
```

Or edit `docker-compose.yml` directly.

## Configuration

Configure the sample via environment variables (all optional, shown with defaults):

| Environment Variable | Default | Description |
|---|---|---|
| `EMULATOR_ORIGIN` | `https://localhost:8443` | Emulator base URL |
| `TENANT_ID` | `11111111-1111-1111-1111-111111111111` | Custom tenant ID (Entra Local default) |
| `CLIENT_ID` | `cccccccc-0000-0000-0000-000000000001` | Public client app ID (seeded Sample SPA) |
| `API_SCOPE` | `https://graph.microsoft.com/.default` | Access token audience/scope (Graph) |
| `EMULATOR_CERT` | `../../../data/tls/cert.pem` | Path to emulator's `cert.pem` for cert pinning |

**Example — non-default emulator port:**

```bash
EMULATOR_ORIGIN=https://localhost:54321 dotnet run
```

## How it works

### MSAL.NET Configuration

The sample uses a **custom authority** (the emulator's GUID-based authority) with two critical settings:

```csharp
var app = PublicClientApplicationBuilder
    .Create(clientId)
    .WithAuthority(authority, validateAuthority: false)   // Trust custom authority
    .WithInstanceDiscovery(false)                         // No egress to login.microsoftonline.com
    .WithRedirectUri("http://localhost:3003")             // Loopback for system browser
    .WithHttpClientFactory(new EmulatorHttpClientFactory(certPath)) // Trust emulator cert
    .Build();
```

- **`validateAuthority: false`** — Disable Microsoft Entra ID authority validation (required for custom authorities)
- **`WithInstanceDiscovery(false)`** — Skip the cloud instance discovery call (no external network requests)
- **`WithRedirectUri("http://localhost:3003")`** — Use a loopback address; this must be registered as a valid redirect URI on the application (`cccccccc-…-0001`)

### Response Mode: form_post

The authorize endpoint is called with `response_mode=form_post` (RFC 8693), which returns an HTML page with an auto-submitted form containing the authorization code. This is **more secure** than the default `response_mode=query` because:

- Authorization parameters are **not** stored in browser history
- Parameters are **not** logged by HTTP proxies or servers
- Preferred by server-side frameworks (e.g., Microsoft.Identity.Web)

MSAL.NET's built-in loopback listener transparently handles form-post responses.

### Certificate Trust (Test-Only)

The sample pins the emulator's self-signed certificate via a custom `HttpClientFactory`:

```csharp
private static bool ValidateServerCert(HttpRequestMessage _, X509Certificate2? cert, X509Chain? __, SslPolicyErrors ___)
{
    return cert is not null && cert.Thumbprint == _emulatorCertThumbprint;
}
```

This validates the cert **thumbprint** — not a blanket "accept any cert" callback. **Do not use this approach in production.** For local development:

- No OS-level trust-store changes required
- Per-application cert pinning
- If the emulator cert is rotated, the thumbprint automatically updates

### Loopback Redirect & System Browser

The sample uses MSAL.NET's built-in **interactive flow** (`AcquireTokenInteractive`), which:

1. Launches the **system default browser** to the authorize endpoint
2. Starts a **loopback HTTP listener** on `127.0.0.1:3003`
3. Waits for the redirect (form-post or query-string)
4. Exchanges the authorization code for tokens via the token endpoint

## Troubleshooting

### "Connection refused: 127.0.0.1:8443" or "CERTIFICATE_VERIFY_FAILED"

**Cause:** Emulator not running.  
**Fix:** Start the emulator in a separate terminal:
```bash
cd /path/to/entra-local
PUBLIC_ORIGIN=https://localhost:8443 npm start
```

### "AADSTS700016: Invalid client secret"

**Cause:** Wrong `CLIENT_ID` or `TENANT_ID`.  
**Fix:** Verify environment variables match the seeded sample app:
```bash
echo $CLIENT_ID  # Should be: cccccccc-0000-0000-0000-000000000001
echo $TENANT_ID  # Should be: 11111111-1111-1111-1111-111111111111
```

### "The authorization server does not support the form_post response mode"

**Cause:** Emulator discovery reports `response_modes_supported` without `form_post`.  
**Fix:** Verify the emulator build includes [feature #6](../../specs/2026-06-22_06-auth-code-pkce-signin.md). Run smoke mode to diagnose:
```bash
dotnet run -- --smoke
```

### "Certificate pinning failed" or "Untrusted certificate"

**Cause:** `EMULATOR_CERT` path is wrong or cert has been regenerated.  
**Fix:** Verify the path to `cert.pem`:
```bash
ls -la /path/to/entra-local/data/tls/cert.pem
EMULATOR_CERT=/full/path/to/cert.pem dotnet run
```

## Non-default emulator configuration

If running the emulator with a non-standard **port** or **origin**:

```bash
# Emulator on a different port
EMULATOR_ORIGIN=https://localhost:54321 dotnet run

# Or with environment on startup
cd /path/to/entra-local
PUBLIC_ORIGIN=https://localhost:54321 npm start
```

If using **local domain subdomains** (e.g., `login.entra.localhost`, `graph.entra.localhost`):

1. Apply local domains to `/etc/hosts` (or Windows `C:\Windows\System32\drivers\etc\hosts`):
   ```bash
   cd /path/to/entra-local
   npx entra-local hosts --apply
   ```

2. Run the sample with the subdomain authority:
   ```bash
   EMULATOR_ORIGIN=https://login.entra.localhost dotnet run
   ```

3. Also update the cert path if needed (should still be `data/tls/cert.pem`).

## Reference documentation

- **MSAL.NET:** [Microsoft.Identity.Client NuGet](https://www.nuget.org/packages/Microsoft.Identity.Client/)
- **Response modes:** [OAuth 2.0 Form Post Response Mode (RFC 8693)](https://tools.ietf.org/html/rfc8693)
- **Authorization Code + PKCE:** [RFC 7636](https://tools.ietf.org/html/rfc7636)
- **Entra Local:** [GitHub repo](../../README.md)

## Sample app registration

The sample uses the **seeded public Sample SPA** (`cccccccc-…-0001`):

- **Client type:** Public (browser/SPA/CLI)
- **Default redirect URIs:**
  - `http://localhost:3000`
  - `http://localhost:3001`
  - **`http://localhost:3003`** ← used by this sample

To view or modify the sample app in the Entra Local portal:

1. Start the emulator
2. Open `https://localhost:5173` (admin portal)
3. Navigate to **Applications**
4. Click on the Sample SPA app (`cccccccc-…-0001`)
5. View or manage its redirect URIs

## What's next?

- Try the **Node.js CLI sample** (`../node-cli/`) for the Device Authorization Grant (RFC 8628)
- Try the **full-stack SPA+API sample** (`../fullstack-spa-api/`) for delegated access to a separate API
- Read the Entra Local [getting started guide](../../docs/msal-client-config.md)
