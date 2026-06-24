// MSAL.NET compatibility smoke-test — feature #13, criterion 3.
//
// Builds a real MSAL.NET ConfidentialClientApplication against the running emulator authority
// (a custom, non-Microsoft authority), performs a REAL AcquireTokenForClient (client-credentials,
// feature #8) for the seeded confidential daemon's `api://<daemonId>/.default` scope, then validates
// the returned JWT (signature via the emulator JWKS `n`/`e`/`kid`, `iss`, `aud`).
//
// Config matrix (see specs/2026-06-22_13-msal-compat-validation.md + docs/msal-client-config.md):
//   .WithAuthority(authority, validateAuthority: false)  -> trust the custom GUID authority
//   .WithInstanceDiscovery(false)                        -> NO egress to login.microsoftonline.com
//   HttpClientFactory pinned to the emulator's self-signed cert.pem (no global trust-store change).
//
// Inputs are passed via environment variables by the test orchestrator. Prints a single
// machine-parseable result line ("MSAL_NET_SMOKE: PASS ..." / "MSAL_NET_SMOKE: FAIL ...") and
// exits non-zero on any failure.

using System.IdentityModel.Tokens.Jwt;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Microsoft.Identity.Client;
using Microsoft.IdentityModel.Tokens;

static string Require(string name)
{
    var value = Environment.GetEnvironmentVariable(name);
    if (string.IsNullOrWhiteSpace(value))
    {
        throw new InvalidOperationException($"missing required env var {name}");
    }
    return value;
}

const string Tag = "MSAL_NET_SMOKE";

try
{
    var origin = Require("EMU_ORIGIN").TrimEnd('/'); // e.g. https://localhost:54321
    var tenantId = Require("EMU_TENANT_ID");
    var daemonId = Require("EMU_DAEMON_ID");
    var daemonSecret = Require("EMU_DAEMON_SECRET");
    var certPath = Require("EMU_CERT_PATH");

    var authority = $"{origin}/{tenantId}";
    var resource = $"api://{daemonId}";
    var scope = $"{resource}/.default";
    var expectedIssuer = $"{origin}/{tenantId}/v2.0";

    // Pin trust to the emulator's self-signed leaf cert (thumbprint match) — test-only, no global
    // trust-store mutation and no blanket "accept anything" validator.
    var trusted = X509Certificate2.CreateFromPem(File.ReadAllText(certPath));
    bool TrustEmulator(HttpRequestMessage _, X509Certificate2? cert, X509Chain? __, SslPolicyErrors ___)
        => cert is not null && cert.Thumbprint == trusted.Thumbprint;

    HttpClient MakeHttpClient()
    {
        var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback = TrustEmulator,
        };
        return new HttpClient(handler);
    }

    var app = ConfidentialClientApplicationBuilder
        .Create(daemonId)
        .WithClientSecret(daemonSecret)
        .WithAuthority(authority, validateAuthority: false)
        .WithInstanceDiscovery(false) // bypass login.microsoftonline.com instance discovery
        .WithHttpClientFactory(new SmokeHttpClientFactory(MakeHttpClient))
        .Build();

    // REAL MSAL token acquisition — drives MSAL's own discovery/JWKS metadata fetch + token call.
    var result = await app
        .AcquireTokenForClient(new[] { scope })
        .ExecuteAsync();

    if (string.IsNullOrEmpty(result.AccessToken))
    {
        Console.WriteLine($"{Tag}: FAIL no access token returned");
        return 1;
    }

    // Validate the returned JWT against the emulator JWKS (signature/issuer/audience).
    using var http = MakeHttpClient();
    var discoveryJson = await http.GetStringAsync($"{authority}/v2.0/.well-known/openid-configuration");
    using var discovery = JsonDocument.Parse(discoveryJson);
    var jwksUri = discovery.RootElement.GetProperty("jwks_uri").GetString()!;
    var jwksJson = await http.GetStringAsync(jwksUri);
    var jwks = new JsonWebKeySet(jwksJson);

    var validationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidIssuer = expectedIssuer,
        ValidateAudience = true,
        ValidAudience = resource,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        IssuerSigningKeys = jwks.GetSigningKeys(),
    };

    var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
    var principal = handler.ValidateToken(result.AccessToken, validationParameters, out var validated);
    var jwt = (JwtSecurityToken)validated;

    var aud = jwt.Audiences.FirstOrDefault() ?? "";
    var iss = jwt.Issuer;
    var roles = string.Join("+", jwt.Claims.Where(c => c.Type == "roles").Select(c => c.Value));

    if (aud != resource)
    {
        Console.WriteLine($"{Tag}: FAIL unexpected aud={aud}");
        return 1;
    }
    if (iss != expectedIssuer)
    {
        Console.WriteLine($"{Tag}: FAIL unexpected iss={iss}");
        return 1;
    }

    Console.WriteLine($"{Tag}: PASS aud={aud} iss={iss} roles={roles} kid={jwt.Header.Kid} sub={principal.FindFirst("sub")?.Value}");
    return 0;
}
catch (Exception ex)
{
    Console.WriteLine($"{Tag}: FAIL {ex.GetType().Name}: {ex.Message}");
    return 1;
}

/// <summary>MSAL HttpClientFactory that hands MSAL an HttpClient trusting the emulator cert.</summary>
internal sealed class SmokeHttpClientFactory(Func<HttpClient> factory) : IMsalHttpClientFactory
{
    private readonly HttpClient _client = factory();

    public HttpClient GetHttpClient() => _client;
}
