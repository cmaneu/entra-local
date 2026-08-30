package dev.entralocal.sample;

import com.azure.core.credential.AccessToken;
import com.azure.core.credential.TokenRequestContext;
import com.azure.core.http.HttpClient;
import com.azure.core.http.jdk.httpclient.JdkHttpClientBuilder;
import com.azure.identity.ClientSecretCredential;
import com.azure.identity.ClientSecretCredentialBuilder;
import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * Entra Local sample #28: the official Java Azure Identity library (MSAL4J underneath) acquiring
 * a client-credentials (app-only) token and calling the emulator's built-in Microsoft Graph
 * `/users` endpoint.
 *
 * <p>This is the exact compatibility scenario reported in
 * <a href="https://github.com/cmaneu/entra-local/issues/28">issue #28</a>: Azure Identity always
 * appends the OIDC companion scopes {@code openid profile offline_access} to a client-credentials
 * token request, even though only {@code https://graph.microsoft.com/.default} is requested here.
 * A correctly-behaving emulator (and real Entra ID) accepts that request; see
 * {@code specs/2026-08-30_28-client-credentials-additional-scopes.md} for the accepted contract.
 *
 * <p>Run with {@code --smoke} for a non-interactive, CI-friendly mode (this flow has no human
 * interaction to begin with — client credentials is a pure service-to-service grant — so
 * {@code --smoke} only changes the output to a single machine-readable status line).
 */
public final class ClientCredentialsSample {
  private static final String GRAPH_DEFAULT_SCOPE = "https://graph.microsoft.com/.default";

  public static void main(String[] args) throws Exception {
    boolean smoke = args.length > 0 && "--smoke".equals(args[0]);

    String origin = env("EMULATOR_ORIGIN", "https://localhost:8443");
    String tenantId = env("TENANT_ID", "11111111-1111-1111-1111-111111111111");
    String clientId = env("CLIENT_ID", "cccccccc-0000-0000-0000-000000000002");
    String clientSecret = env("CLIENT_SECRET", "daemon-app-secret");

    try {
      java.net.http.HttpClient.Builder jdkBuilder = Trust.builder();
      java.net.http.HttpClient jdkHttpClient = jdkBuilder.build();
      HttpClient azureHttpClient = new JdkHttpClientBuilder(jdkBuilder).build();

      if (!smoke) {
        System.out.println("Entra Local — Java Azure Identity client-credentials sample");
        System.out.println("  authority : " + origin + "/" + tenantId);
        System.out.println("  clientId  : " + clientId);
        System.out.println("  requesting scope (Azure Identity appends OIDC companion scopes):");
        System.out.println("    " + GRAPH_DEFAULT_SCOPE);
      }

      ClientSecretCredential credential =
          new ClientSecretCredentialBuilder()
              .tenantId(tenantId)
              .clientId(clientId)
              .clientSecret(clientSecret)
              // Entra Local isn't a recognized cloud authority; without this, Azure Identity
              // tries to validate it against login.microsoftonline.com first and fails offline.
              .authorityHost(origin)
              .disableInstanceDiscovery()
              .httpClient(azureHttpClient)
              .build();

      TokenRequestContext request = new TokenRequestContext().addScopes(GRAPH_DEFAULT_SCOPE);
      AccessToken accessToken = credential.getToken(request).block();
      if (accessToken == null) {
        throw new IllegalStateException("Azure Identity returned no access token.");
      }
      String token = accessToken.getToken();

      if (!smoke) {
        System.out.println();
        System.out.println("Token acquired. Decoded claims:");
        System.out.println(decodeClaims(token));
      }

      HttpRequest graphRequest =
          HttpRequest.newBuilder(URI.create(origin + "/graph/v1.0/users"))
              .header("Authorization", "Bearer " + token)
              .GET()
              .build();
      HttpResponse<String> graphResponse =
          jdkHttpClient.send(graphRequest, HttpResponse.BodyHandlers.ofString());

      if (graphResponse.statusCode() != 200) {
        throw new IllegalStateException(
            "GET /graph/v1.0/users returned " + graphResponse.statusCode() + ": " + graphResponse.body());
      }

      if (smoke) {
        System.out.println("SMOKE_OK aud-check-pending users=" + graphResponse.body().length() + "bytes");
      } else {
        System.out.println();
        System.out.println("GET /graph/v1.0/users -> 200:");
        System.out.println(graphResponse.body());
      }
    } catch (Exception e) {
      System.err.println("FAILED: " + e.getMessage());
      if (!smoke) {
        e.printStackTrace();
      }
      System.err.println();
      System.err.println("Troubleshooting:");
      System.err.println(" - Is the emulator running at " + origin + "? (pnpm start, PUBLIC_ORIGIN=" + origin + ")");
      System.err.println(" - Untrusted cert? Set EMULATOR_CA_CERT to the emulator's data/tls/cert.pem.");
      System.err.println(" - Wrong secret? The default seeded daemon secret is 'daemon-app-secret'.");
      System.exit(1);
    }
  }

  private static String env(String name, String fallback) {
    String v = System.getenv(name);
    return (v == null || v.isBlank()) ? fallback : v;
  }

  /** Base64url-decode the JWT payload segment (no signature verification — sample display only). */
  private static String decodeClaims(String jwt) {
    String[] parts = jwt.split("\\.");
    if (parts.length < 2) {
      return "(not a JWT)";
    }
    byte[] payload = Base64.getUrlDecoder().decode(parts[1]);
    return new String(payload, StandardCharsets.UTF_8);
  }
}
