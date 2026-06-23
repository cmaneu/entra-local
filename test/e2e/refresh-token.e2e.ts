import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { request as httpsRequest } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PublicClientApplication,
  type INetworkModule,
  type NetworkRequestOptions,
  type NetworkResponse,
} from '@azure/msal-node';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import type { Browser, BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/loadConfig.js';
import { createServer, type RunningServer } from '../../src/server.js';
import { sha256 } from '../../src/store/hashing.js';
import { SEED } from '../../src/store/seed.js';
import { launchBrowserContext } from '../helpers/msalDrivers.js';

/**
 * Real-MSAL silent-renewal end-to-end (feature #7, criterion 11). Extends #6's Authorization Code +
 * PKCE flow: after interactive sign-in MSAL exchanges its refresh token at `/token`
 * (`grant_type=refresh_token`) and receives a JWKS-verifiable access token plus a rotated refresh
 * token. Asserted for BOTH transports:
 *   - `@azure/msal-browser` (headless Chromium): `acquireTokenSilent({ forceRefresh: true })`
 *     bypasses the cached access token and drives the refresh-token grant cross-origin.
 *   - `@azure/msal-node`: `acquireTokenByRefreshToken` redeems a refresh token over real HTTPS
 *     (trusting the emulator's self-signed cert via a custom network module).
 */

const TMP_DIR = fileURLToPath(new URL('../../data/.tmp/', import.meta.url));
const TENANT = '11111111-1111-1111-1111-111111111111';
const SPA_SCOPE = `api://${SEED.appSpaId}/${SEED.spaScopeValue}`;
const SCOPES = ['openid', 'profile', 'offline_access', SPA_SCOPE];

let server: RunningServer;
let spa: HttpsServer;
let spaOrigin: string;
let browser: Browser;
let context: BrowserContext;
let ca: string;
let authority: string;
const certDir = join(TMP_DIR, `e2e-refresh-${randomUUID()}`);

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

/** A custom MSAL network module that trusts the emulator's self-signed cert (the `ca` PEM). */
function caNetworkModule(caCert: string): INetworkModule {
  const send = <T>(
    method: 'GET' | 'POST',
    url: string,
    options?: NetworkRequestOptions,
  ): Promise<NetworkResponse<T>> =>
    new Promise((resolve, reject) => {
      const u = new URL(url);
      const data = options?.body;
      const req = httpsRequest(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          method,
          ca: caCert,
          headers: {
            ...(options?.headers ?? {}),
            ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          },
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              headers[k] = Array.isArray(v) ? v.join(',') : String(v ?? '');
            }
            let body: unknown = raw;
            try {
              body = JSON.parse(raw);
            } catch {
              /* non-JSON body (left as the raw string) */
            }
            resolve({ headers, body: body as T, status: res.statusCode ?? 0 });
          });
        },
      );
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  return {
    sendGetRequestAsync: (url, options) => send('GET', url, options),
    sendPostRequestAsync: (url, options) => send('POST', url, options),
  };
}

/**
 * The static SPA page: msal-browser signs in (loginRedirect → handleRedirectPromise), confirms the
 * first silent call resolves from cache, then forces a refresh-token exchange via
 * `acquireTokenSilent({ forceRefresh: true })` and records the renewed (network) access token.
 */
function spaIndexHtml(
  clientId: string,
  authorityUrl: string,
  host: string,
  redirectUri: string,
): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>e2e refresh SPA</title></head>
<body>
<script src="/msal-browser.min.js"></script>
<script>
window.__result = { status: "init" };
const config = {
  auth: {
    clientId: ${JSON.stringify(clientId)},
    authority: ${JSON.stringify(authorityUrl)},
    knownAuthorities: [${JSON.stringify(host)}],
    redirectUri: ${JSON.stringify(redirectUri)}
  },
  cache: { cacheLocation: "sessionStorage" }
};
const scopes = ${JSON.stringify(SCOPES)};
(async () => {
  try {
    const pca = new msal.PublicClientApplication(config);
    await pca.initialize();
    const resp = await pca.handleRedirectPromise();
    if (resp && resp.account) {
      const silent = await pca.acquireTokenSilent({ scopes, account: resp.account });
      const renewed = await pca.acquireTokenSilent({ scopes, account: resp.account, forceRefresh: true });
      window.__result = {
        status: "done",
        accessToken: resp.accessToken,
        cachedFromCache: silent.fromCache,
        renewedAccessToken: renewed.accessToken,
        renewedFromCache: renewed.fromCache,
        homeAccountId: renewed.account ? renewed.account.homeAccountId : null,
        username: renewed.account ? renewed.account.username : null
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
    DB_PATH: join(TMP_DIR, `e2e-refresh-${randomUUID()}.db`),
  });
  server = await createServer(config);
  ca = readFileSync(join(certDir, 'cert.pem'), 'utf8');
  const key = readFileSync(join(certDir, 'key.pem'), 'utf8');

  const spaPort = await getFreePort();
  spaOrigin = `https://localhost:${spaPort}`;
  const redirectUri = `${spaOrigin}/`;
  authority = `${server.origin}/${TENANT}`;
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

  server.app.store.apps.addRedirectUri(SEED.appSpaId, redirectUri, 'spa');

  ({ browser, context } = await launchBrowserContext());
}, 60_000);

afterAll(async () => {
  await context?.close();
  await browser?.close();
  await new Promise<void>((resolve) => (spa ? spa.close(() => resolve()) : resolve()));
  await server?.close();
  rmSync(certDir, { recursive: true, force: true });
});

/** Load the emulator's live JWKS over HTTPS. */
async function liveJwks(): Promise<ReturnType<typeof createLocalJWKSet>> {
  const { body: discovery } = await httpsGetJson<{ jwks_uri: string }>(
    `${server.origin}/${TENANT}/v2.0/.well-known/openid-configuration`,
  );
  const jwksPath = new URL(discovery.jwks_uri).pathname;
  const { body: jwksDoc } = await httpsGetJson<JSONWebKeySet>(`${server.origin}${jwksPath}`);
  return createLocalJWKSet(jwksDoc);
}

describe('real-MSAL silent renewal e2e (criterion 11)', () => {
  it('@azure/msal-browser forceRefresh exchanges the refresh token for a JWKS-verifiable access token', async () => {
    const page = await context.newPage();
    await page.goto(`${spaOrigin}/`, { waitUntil: 'load' });

    await page.waitForSelector('button[name="__el_user"]', { timeout: 30_000 });
    await page.click(`button[name="__el_user"][value="${SEED.userAliceId}"]`);

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
      accessToken?: string;
      cachedFromCache?: boolean;
      renewedAccessToken?: string;
      renewedFromCache?: boolean;
      homeAccountId?: string;
      username?: string;
    };

    expect(result.status, `MSAL error: ${result.error ?? ''}`).toBe('done');
    // First silent call resolved from cache; the forced one performed a network refresh.
    expect(result.cachedFromCache).toBe(true);
    expect(result.renewedFromCache).toBe(false);
    expect(result.renewedAccessToken).toBeTruthy();
    expect(result.username).toBe('alice@entralocal.dev');
    expect(result.homeAccountId).toContain(`.${TENANT}`);
    expect(result.homeAccountId).toContain(SEED.userAliceId);

    // The renewed access token verifies against the emulator's live JWKS with the right claims.
    const jwks = await liveJwks();
    const access = await jwtVerify(result.renewedAccessToken as string, jwks);
    expect(access.payload.scp).toContain(SEED.spaScopeValue);
    expect(access.payload.aud).toBe(SEED.appSpaId);

    await page.close();
  }, 90_000);

  it('@azure/msal-node acquireTokenByRefreshToken redeems + rotates the refresh token', async () => {
    // Seed a refresh token for the SPA + Alice in-process; msal-node redeems it over real HTTPS.
    const seedRefreshToken = server.app.tokenService.issueRefreshToken({
      appId: SEED.appSpaId,
      userId: SEED.userAliceId,
      scopes: SCOPES,
      resource: `api://${SEED.appSpaId}`,
    });

    const pca = new PublicClientApplication({
      auth: {
        clientId: SEED.appSpaId,
        authority,
        knownAuthorities: [new URL(authority).host],
      },
      system: { networkClient: caNetworkModule(ca) },
    });

    const result = await pca.acquireTokenByRefreshToken({
      refreshToken: seedRefreshToken,
      scopes: SCOPES,
      forceCache: true,
    });

    expect(result, 'msal-node returned no result').not.toBeNull();
    expect(result!.accessToken).toBeTruthy();
    // Account identity is built from the response `client_info` (uid.utid).
    expect(result!.account?.homeAccountId).toContain(`.${TENANT}`);
    expect(result!.account?.homeAccountId).toContain(SEED.userAliceId);

    // The access token verifies against the live JWKS.
    const jwks = await liveJwks();
    const access = await jwtVerify(result!.accessToken, jwks);
    expect(access.payload.scp).toContain(SEED.spaScopeValue);
    expect(access.payload.aud).toBe(SEED.appSpaId);

    // Rotation: the presented refresh token was revoked by the redemption.
    const presented = server.app.store.refreshTokens.getByHash(sha256(seedRefreshToken));
    expect(presented?.revoked).toBe(true);
  }, 60_000);
});
