import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { request as httpsRequest } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import type { BrowserContext, Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/loadConfig.js';
import { createServer, type RunningServer } from '../../src/server.js';
import { SEED } from '../../src/store/seed.js';
import { launchBrowserContext } from '../helpers/msalDrivers.js';

/**
 * Real-MSAL end-to-end (criterion 10): a static `@azure/msal-browser` SPA driven headlessly by
 * Playwright completes Authorization Code + PKCE against the running emulator, receives
 * JWKS-verifiable ID + access tokens, and confirms `acquireTokenSilent` resolves them from cache
 * (relying on the `client_info` account identity from #5). Default AAD `protocolMode` with
 * `knownAuthorities` is used so the `client_info`-based account identity is exercised.
 */

const TMP_DIR = fileURLToPath(new URL('../../data/.tmp/', import.meta.url));
const TENANT = '11111111-1111-1111-1111-111111111111';

let server: RunningServer;
let spa: HttpsServer;
let spaOrigin: string;
let browser: Browser;
let context: BrowserContext;
let ca: string;
const certDir = join(TMP_DIR, `e2e-authcode-${randomUUID()}`);

/** Reserve a free TCP port (probe → close → reuse). */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** GET over HTTPS returning parsed JSON (trusting the emulator's self-signed cert). */
function httpsGetJson<T>(url: string): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET', ca },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) as T });
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** The static SPA page: msal-browser drives loginRedirect → handleRedirectPromise → silent. */
function spaIndexHtml(
  clientId: string,
  authority: string,
  host: string,
  redirectUri: string,
): string {
  const scopes = ['openid', 'profile', 'offline_access', `api://${clientId}/${SEED.spaScopeValue}`];
  return `<!doctype html><html><head><meta charset="utf-8"><title>e2e SPA</title></head>
<body>
<script src="/msal-browser.min.js"></script>
<script>
window.__result = { status: "init" };
const config = {
  auth: {
    clientId: ${JSON.stringify(clientId)},
    authority: ${JSON.stringify(authority)},
    knownAuthorities: [${JSON.stringify(host)}],
    redirectUri: ${JSON.stringify(redirectUri)}
  },
  cache: { cacheLocation: "sessionStorage" }
};
const scopes = ${JSON.stringify(scopes)};
(async () => {
  try {
    const pca = new msal.PublicClientApplication(config);
    await pca.initialize();
    const resp = await pca.handleRedirectPromise();
    if (resp && resp.account) {
      const silent = await pca.acquireTokenSilent({ scopes, account: resp.account });
      window.__result = {
        status: "done",
        idToken: resp.idToken,
        accessToken: resp.accessToken,
        homeAccountId: resp.account.homeAccountId,
        username: resp.account.username,
        silentAccessToken: silent.accessToken,
        fromCache: silent.fromCache
      };
    } else if (pca.getAllAccounts().length === 0) {
      window.__result = { status: "redirecting" };
      await pca.loginRedirect({ scopes });
    }
  } catch (e) {
    window.__result = { status: "error", error: String((e && e.message) || e) };
  }
})();
</script>
</body></html>`;
}

beforeAll(async () => {
  // 1) Boot the emulator on a fixed free port so its issuer/origin match the bound port (MSAL
  //    authority validation compares the discovery issuer host:port against the authority).
  const emulatorPort = await getFreePort();
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CONFIG_FILE: join(TMP_DIR, `${randomUUID()}.none.json`),
    HOST: 'localhost',
    PORT: String(emulatorPort),
    TENANT_ID: TENANT,
    TLS_ENABLED: 'true',
    TLS_CERT_DIR: certDir,
    DB_PATH: join(TMP_DIR, `e2e-authcode-${randomUUID()}.db`),
  });
  server = await createServer(config);
  ca = readFileSync(join(certDir, 'cert.pem'), 'utf8');
  const key = readFileSync(join(certDir, 'key.pem'), 'utf8');

  // 2) Serve the SPA fixture over HTTPS on its own free port, reusing the emulator's cert (same CN).
  const spaPort = await getFreePort();
  spaOrigin = `https://localhost:${spaPort}`;
  const redirectUri = `${spaOrigin}/`;
  const authority = `${server.origin}/${TENANT}`;
  const emulatorHost = new URL(server.origin).host;
  const msalBundle = readFileSync(
    fileURLToPath(
      new URL('../../node_modules/@azure/msal-browser/lib/msal-browser.min.js', import.meta.url),
    ),
    'utf8',
  );
  const indexHtml = spaIndexHtml(SEED.appSpaId, authority, emulatorHost, redirectUri);

  spa = createHttpsServer({ key, cert: ca }, (req, res) => {
    if (req.url && req.url.startsWith('/msal-browser.min.js')) {
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      res.end(msalBundle);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
  });
  await new Promise<void>((resolve) => spa.listen(spaPort, '127.0.0.1', resolve));

  // 3) Register the SPA fixture origin as a redirect URI for the seeded public SPA app.
  server.app.store.apps.addRedirectUri(SEED.appSpaId, redirectUri, 'spa');

  // 4) Launch a headless Chromium that trusts the self-signed certs.
  ({ browser, context } = await launchBrowserContext());
}, 60_000);

afterAll(async () => {
  await context?.close();
  await browser?.close();
  await new Promise<void>((resolve) => (spa ? spa.close(() => resolve()) : resolve()));
  await server?.close();
  rmSync(certDir, { recursive: true, force: true });
});

describe('real-MSAL Auth Code + PKCE e2e (criterion 10)', () => {
  it('completes interactive sign-in and caches JWKS-verifiable ID + access tokens', async () => {
    const page = await context.newPage();
    await page.goto(`${spaOrigin}/`, { waitUntil: 'load' });

    // MSAL loginRedirect navigated the top window to the emulator's account picker. Pick Alice.
    await page.waitForSelector('button[name="__el_user"]', { timeout: 30_000 });
    await page.click(`button[name="__el_user"][value="${SEED.userAliceId}"]`);

    // After the redirect back, MSAL completes the code+PKCE exchange and runs acquireTokenSilent.
    await page.waitForFunction(
      () => {
        const r = (globalThis as unknown as { __result?: { status?: string } }).__result;
        return r !== undefined && (r.status === 'done' || r.status === 'error');
      },
      { timeout: 30_000 },
    );

    const result = (await page.evaluate(
      () => (globalThis as unknown as { __result: Record<string, unknown> }).__result,
    )) as {
      status: string;
      error?: string;
      idToken?: string;
      accessToken?: string;
      homeAccountId?: string;
      username?: string;
      silentAccessToken?: string;
      fromCache?: boolean;
    };

    expect(result.status, `MSAL error: ${result.error ?? ''}`).toBe('done');
    expect(result.idToken).toBeTruthy();
    expect(result.accessToken).toBeTruthy();
    expect(result.username).toBe('alice@entralocal.dev');
    // client_info-based account identity (uid.utid) from #5.
    expect(result.homeAccountId).toContain(`.${TENANT}`);
    expect(result.homeAccountId).toContain(SEED.userAliceId);

    // acquireTokenSilent must resolve from the MSAL cache (no interaction / network).
    expect(result.fromCache).toBe(true);
    expect(result.silentAccessToken).toBe(result.accessToken);

    // The received tokens verify against the emulator's live JWKS.
    const { body: discovery } = await httpsGetJson<{ jwks_uri: string; issuer: string }>(
      `${server.origin}/${TENANT}/v2.0/.well-known/openid-configuration`,
    );
    const jwksPath = new URL(discovery.jwks_uri).pathname;
    const { body: jwksDoc } = await httpsGetJson<JSONWebKeySet>(`${server.origin}${jwksPath}`);
    const jwks = createLocalJWKSet(jwksDoc);

    const id = await jwtVerify(result.idToken as string, jwks);
    expect(id.payload.iss).toBe(discovery.issuer);
    expect(id.payload.aud).toBe(SEED.appSpaId);
    expect(id.payload.preferred_username).toBe('alice@entralocal.dev');

    const access = await jwtVerify(result.accessToken as string, jwks);
    expect(access.payload.scp).toContain(SEED.spaScopeValue);

    await page.close();
  }, 90_000);
});
