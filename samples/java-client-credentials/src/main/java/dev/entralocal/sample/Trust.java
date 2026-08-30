package dev.entralocal.sample;

import java.io.FileInputStream;
import java.io.InputStream;
import java.net.http.HttpClient;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/**
 * Development-only TLS trust for Entra Local's self-signed certificate (#28's Java sample).
 *
 * <p>Entra Local writes its auto-generated dev certificate to {@code data/tls/cert.pem} at the
 * repo root (documented in the main README's "Certificate trust" section). This mirrors the
 * {@code samples/node-cli} convention: prefer trusting exactly that one certificate
 * ({@code EMULATOR_CA_CERT}, defaulting to {@code ../../data/tls/cert.pem} relative to this
 * sample's working directory), and only fall back to trusting any certificate (printing a loud
 * warning) if that file isn't found. Never do this against a real endpoint.
 */
final class Trust {
  private Trust() {}

  static HttpClient buildHttpClient() throws Exception {
    return builder().build();
  }

  /** The same dev-only trust config, exposed as a builder so it can back two separate clients. */
  static HttpClient.Builder builder() throws Exception {
    return HttpClient.newBuilder().sslContext(buildSslContext());
  }

  private static SSLContext buildSslContext() throws Exception {
    String certProp = System.getenv("EMULATOR_CA_CERT");
    Path certPath = Path.of(certProp != null ? certProp : "../../data/tls/cert.pem");

    SSLContext ctx = SSLContext.getInstance("TLS");
    if (Files.isRegularFile(certPath)) {
      System.err.println("Trusting emulator dev certificate: " + certPath.toAbsolutePath());
      ctx.init(null, trustManagersFor(certPath), new SecureRandom());
    } else {
      System.err.println(
          "WARNING: "
              + certPath.toAbsolutePath()
              + " not found; falling back to trust-all TLS (dev-only, local emulator only). "
              + "Set EMULATOR_CA_CERT to the emulator's data/tls/cert.pem to trust it exactly.");
      ctx.init(null, new TrustManager[] {insecureTrustAll()}, new SecureRandom());
    }
    return ctx;
  }

  private static TrustManager[] trustManagersFor(Path certPath) throws Exception {
    CertificateFactory cf = CertificateFactory.getInstance("X.509");
    X509Certificate cert;
    try (InputStream in = new FileInputStream(certPath.toFile())) {
      cert = (X509Certificate) cf.generateCertificate(in);
    }
    KeyStore keyStore = KeyStore.getInstance(KeyStore.getDefaultType());
    keyStore.load(null, null);
    keyStore.setCertificateEntry("entra-local-dev", cert);

    TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
    tmf.init(keyStore);
    return tmf.getTrustManagers();
  }

  /** Trust-all fallback, used only when the emulator's own cert file can't be found. */
  private static X509TrustManager insecureTrustAll() {
    return new X509TrustManager() {
      public void checkClientTrusted(X509Certificate[] chain, String authType) {}

      public void checkServerTrusted(X509Certificate[] chain, String authType) {}

      public X509Certificate[] getAcceptedIssuers() {
        return new X509Certificate[0];
      }
    };
  }
}
