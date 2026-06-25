import cors from 'cors';
import express from 'express';
import { createAuthMiddleware, type AuthedRequest, probeJwks } from './auth.js';
import { issuer, jwksUri, loadConfig } from './config.js';

/** In-memory sample data — this resource server intentionally has no database. */
const TODOS = [
  { id: 1, title: 'Trust the Entra Local dev certificate', done: true },
  { id: 2, title: 'Sign in from the SPA', done: true },
  { id: 3, title: 'Call this protected API with the access token', done: false },
];

const config = loadConfig();
const app = express();

app.use(cors({ origin: config.spaOrigin }));

// Open health probe — no token required. Useful for the CI smoke and docker healthchecks.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const requireAuth = createAuthMiddleware(config);

// Protected resource: only reachable with a valid access token whose `aud` is THIS API app
// and whose `scp` contains the required scope. Echoes the validated caller claims back so the
// SPA can display exactly which token reached the API.
app.get('/api/todos', requireAuth, (req: AuthedRequest, res) => {
  const claims = req.claims!;
  res.json({
    caller: {
      oid: claims.oid ?? null,
      preferred_username: claims.preferred_username ?? null,
      azp: claims.azp ?? claims.appid ?? null,
      aud: claims.aud ?? null,
      scp: claims.scp ?? null,
    },
    todos: TODOS,
  });
});

app.listen(config.port, () => {
  /* eslint-disable no-console -- sample startup banner */
  console.log(`Sample full-stack API listening on http://localhost:${config.port}`);
  console.log('Validating Bearer tokens against the Entra Local emulator:');
  console.log(`  issuer:   ${issuer(config)}`);
  console.log(`  audience: ${config.apiAppId}`);
  console.log(`  scope:    ${config.requiredScope}`);
  console.log(`  JWKS:     ${jwksUri(config)}`);
  console.log(`  CORS origin allowed: ${config.spaOrigin}`);
  console.log(`  emulator cert (CA): ${config.caCertPath}`);

  // Probe the JWKS endpoint at boot so a TLS / connectivity problem is reported immediately,
  // instead of only surfacing as a 401 on the first "Load todos" call.
  void probeJwks(config).then((result) => {
    if (result.ok) {
      console.log(`  JWKS reachable: yes (${result.keyCount ?? 0} signing key(s) fetched).`);
    } else {
      console.warn(
        '\n[warning] Could not fetch the emulator JWKS at startup. Protected requests will fail\n' +
          '          with 401 until this is fixed. Most likely the emulator is not running, or its\n' +
          '          dev certificate is not trusted. Set EMULATOR_CA_CERT to the emulator cert.pem\n' +
          "          (see this sample's README → Certificate trust). Underlying error:",
      );
      console.warn(' ', result.error);
    }
  });
  /* eslint-enable no-console */
});
