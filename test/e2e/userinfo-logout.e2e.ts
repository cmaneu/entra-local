import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { request as httpsRequest } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeJwt } from 'jose';
import type { Browser, BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/loadConfig.js';
import { createServer, type RunningServer } from '../../src/server.js';
import { SEED } from '../../src/store/seed.js';
import { launchBrowserContext } from '../helpers/msalDrivers.js';

/**
 * Real-MSAL end-to-end (feature #9, criterion 10): a static `@azure/msal-browser` SPA driven
 * headlessly by Playwright signs in via Authorization Code + PKCE (requesting a Graph-audience
 * access token), calls `/graph/oidc/userinfo` with that access token and gets the user's claims,
 * then drives `pca.logoutRedirect` against `/{tenant}/oauth2/v2.0/logout` — after which a fresh load
 * requires interactive re-login (the SSO session is gone).
 */

const TMP_DIR = fileURLToPath(new URL('../../data/.tmp/', import.meta.url));
const TENANT = '11111111-1111-1111-1111-111111111111';
const GRAPH_SCOPE = 'https://graph.microsoft.com/User.Read';

let server: RunningServer;
let spa: HttpsServer;
let spaOrigin: string;
let browser: Browser;
let context: BrowserContext;
let ca: string;
const certDir = join(TMP_DIR, `e2e-userinfo-${randomUUID()}`);

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

/** HTTPS request returning `{ status, body }` (trusting the emulator's self-signed cert). */
function httpsJson<T>(
  url: string,
  opts: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: opts.method ?? 'GET',
        headers: opts.headers,
        ca,
      },
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

/** The static SPA: msal-browser signs in for a Graph-audience token and exposes a logout trigger. */
function spaIndexHtml(
  clientId: string,
  authority: string,
  host: string,
  redirectUri: string,
): string {
  const scopes = ['openid', 'profile', 'offline_access', GRAPH_SCOPE];
  return `<!doctype html><html><head><meta charset="utf-8"><title>e2e userinfo SPA</title></head>
<body>
<script src="/msal-browser.min.js"></script>
<script>
window.__result = { status: "init" };
const config = {
  auth: {
    clientId: ${JSON.stringify(clientId)},
    authority: ${JSON.stringify(authority)},
    knownAuthorities: [${JSON.stringify(host)}],
    redirectUri: ${JSON.stringify(redirectUri)},
    postLogoutRedirectUri: ${JSON.stringify(redirectUri)}
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
      window.__logout = () => pca.logoutRedirect({
        account: resp.account,
        idTokenHint: resp.idToken,
        postLogoutRedirectUri: ${JSON.stringify(redirectUri)}
      });
      window.__result = {
        status: "done",
        idToken: resp.idToken,
        accessToken: resp.accessToken,
        username: resp.account.username
      };
    } else if (pca.getAllAccounts().length === 0) {
      window.__result = { status: "redirecting" };
      await pca.loginRedirect({ scopes });
    } else {
      window.__result = { status: "stale-account" };
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
    DB_PATH: join(TMP_DIR, `e2e-userinfo-${randomUUID()}.db`),
  });
  server = await createServer(config);
  ca = readFileSync(join(certDir, 'cert.pem'), 'utf8');
  const key = readFileSync(join(certDir, 'key.pem'), 'utf8');

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

  // Register the SPA fixture origin as a redirect URI (also reused as the post-logout URI allowlist).
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

describe('real-MSAL UserInfo + Logout e2e (criterion 10)', () => {
  it('signs in, fetches /userinfo with the access token, then logs out (re-login required)', async () => {
    const page = await context.newPage();
    await page.goto(`${spaOrigin}/`, { waitUntil: 'load' });

    // MSAL loginRedirect navigated to the account picker. Pick Alice.
    await page.waitForSelector('button[name="__el_user"]', { timeout: 30_000 });
    await page.click(`button[name="__el_user"][value="${SEED.userAliceId}"]`);

    // Back at the SPA, MSAL completes the code+PKCE exchange.
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
      username?: string;
    };

    expect(result.status, `MSAL error: ${result.error ?? ''}`).toBe('done');
    expect(result.accessToken).toBeTruthy();
    expect(result.username).toBe('alice@entralocal.dev');

    // The access token is Graph-audience and carries the user's oid.
    const accessClaims = decodeJwt(result.accessToken as string);
    expect(accessClaims.aud).toBe('https://graph.microsoft.com');
    expect(accessClaims.oid).toBe(SEED.userAliceId);

    // Call UserInfo with the real acquired access token → user claims.
    const userInfo = await httpsJson<Record<string, unknown>>(
      `${server.origin}/graph/oidc/userinfo`,
      {
        headers: { authorization: `Bearer ${result.accessToken as string}` },
      },
    );
    expect(userInfo.status).toBe(200);
    expect(userInfo.body.sub).toBe(accessClaims.sub);
    expect(userInfo.body.oid).toBe(SEED.userAliceId);
    expect(userInfo.body.preferred_username).toBe('alice@entralocal.dev');
    expect(userInfo.body.email).toBe('alice@entralocal.dev');

    // The ID token's sub matches the UserInfo sub (RP correlation).
    expect(userInfo.body.sub).toBe(decodeJwt(result.idToken as string).sub);

    // Minimal Graph (#10): the same real MSAL-acquired access token is consumed by /graph/v1.0/me
    // and returns Alice's Graph-cased profile (proves the cross-feature mint→consume loop e2e).
    const me = await httpsJson<Record<string, unknown>>(`${server.origin}/graph/v1.0/me`, {
      headers: { authorization: `Bearer ${result.accessToken as string}` },
    });
    expect(me.status).toBe(200);
    expect(me.body['@odata.context']).toBe(`${server.origin}/graph/v1.0/$metadata#users/$entity`);
    expect(me.body.id).toBe(SEED.userAliceId);
    expect(me.body.displayName).toBe('Alice Example');
    expect(me.body.userPrincipalName).toBe('alice@entralocal.dev');
    expect(me.body.mail).toBe('alice@entralocal.dev');

    // Drive MSAL logout → /logout clears the session; the post-logout redirect returns to the SPA,
    // which (cache cleared) immediately starts a fresh interactive login → the account picker.
    await page.evaluate(() => {
      const w = globalThis as unknown as { __logout?: () => Promise<void> };
      void w.__logout?.();
    });

    // Re-login is required: the emulator account picker is shown again (SSO session gone).
    await page.waitForSelector('button[name="__el_user"]', { timeout: 30_000 });
    expect(new URL(page.url()).pathname).toContain('/oauth2/v2.0/authorize');

    await page.close();
  }, 90_000);
});
