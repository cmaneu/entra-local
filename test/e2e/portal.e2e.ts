import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { request as httpsRequest } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/loadConfig.js';
import { createServer, type RunningServer } from '../../src/server.js';
import { SEED } from '../../src/store/seed.js';
import { launchBrowserContext } from '../helpers/msalDrivers.js';

/**
 * Portal end-to-end (#12): the real Vite-built admin portal is served at `/` by the emulator's SPA
 * fallback and driven headlessly by Playwright. Covers deep-link routing, user/group/app CRUD, the
 * show-once secret dialog, seed/reset, and — the marquee criterion 7 — an app created ENTIRELY
 * through the portal whose generated `@azure/msal-browser` config completes a real Authorization
 * Code + PKCE sign-in.
 */

const TMP_DIR = fileURLToPath(new URL('../../data/.tmp/', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORTAL_INDEX = join(REPO_ROOT, 'portal', 'dist', 'index.html');
const TENANT = '11111111-1111-1111-1111-111111111111';

let server: RunningServer;
let browser: Browser;
let context: BrowserContext;
let ca: string;
let key: string;
const certDir = join(TMP_DIR, `e2e-portal-${randomUUID()}`);
const spaServers: HttpsServer[] = [];

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

function httpsGetText(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET', ca },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function httpsGetJson<T>(url: string): Promise<{ status: number; body: T }> {
  return httpsGetText(url).then(({ status, body }) => ({ status, body: JSON.parse(body) as T }));
}

/** Static msal-browser SPA that runs Auth Code + PKCE with a portal-generated config. */
function portalSpaHtml(
  clientId: string,
  authority: string,
  host: string,
  redirectUri: string,
  scopes: string[],
): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>portal e2e SPA</title></head>
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
      window.__result = {
        status: "done",
        idToken: resp.idToken,
        accessToken: resp.accessToken,
        username: resp.account.username
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
  // Ensure the real portal bundle exists (build it once if a prior `npm run build` didn't).
  if (!existsSync(PORTAL_INDEX)) {
    execFileSync('node', ['scripts/build-portal.mjs'], { cwd: REPO_ROOT, stdio: 'inherit' });
  }

  const emulatorPort = await getFreePort();
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CONFIG_FILE: join(TMP_DIR, `${randomUUID()}.none.json`),
    HOST: 'localhost',
    PORT: String(emulatorPort),
    PUBLIC_ORIGIN: `https://localhost:${emulatorPort}`,
    TENANT_ID: TENANT,
    TLS_ENABLED: 'true',
    TLS_CERT_DIR: certDir,
    DB_PATH: join(TMP_DIR, `e2e-portal-${randomUUID()}.db`),
  });
  server = await createServer(config);
  ca = readFileSync(join(certDir, 'cert.pem'), 'utf8');
  key = readFileSync(join(certDir, 'key.pem'), 'utf8');

  ({ browser, context } = await launchBrowserContext());
}, 120_000);

afterAll(async () => {
  await context?.close();
  await browser?.close();
  for (const s of spaServers) await new Promise<void>((resolve) => s.close(() => resolve()));
  await server?.close();
  rmSync(certDir, { recursive: true, force: true });
});

/** Open the portal at a path and wait for the shell to mount. */
async function openPortal(path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${server.origin}${path}`, { waitUntil: 'load' });
  await page.getByRole('link', { name: 'App registrations' }).waitFor({ timeout: 30_000 });
  return page;
}

describe('Portal e2e (#12)', () => {
  it('serves the portal at / and resolves deep links via the SPA fallback (not 404)', async () => {
    const rootRes = await httpsGetText(`${server.origin}/`);
    expect(rootRes.status).toBe(200);
    expect(rootRes.body).toContain('<div id="root">');

    // A client-side deep link is served the same SPA HTML (server returns 200, not a JSON 404).
    const deep = await httpsGetText(`${server.origin}/apps/${SEED.appSpaId}`);
    expect(deep.status).toBe(200);
    expect(deep.body).toContain('<div id="root">');

    // …and the React router actually renders the App detail route for the deep link.
    const page = await openPortal(`/apps/${SEED.appSpaId}`);
    await page.getByTestId('msal-snippet').waitFor({ timeout: 30_000 });
    await page.close();
  }, 60_000);

  it('creates, edits and deletes a user through the portal', async () => {
    const page = await openPortal('/users');
    const upn = `e2e-${Date.now()}@entralocal.dev`;

    await page
      .getByRole('button', { name: /New user/ })
      .first()
      .click();
    await page.getByLabel('User principal name').fill(upn);
    await page.getByLabel('Display name').fill('E2E User');
    await page.getByRole('button', { name: 'Create user' }).click();
    await page.getByText(upn).waitFor({ timeout: 15_000 });

    // Edit: rename via the row overflow menu.
    await page.getByRole('button', { name: `Actions for ${upn}` }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const dn = page.getByLabel('Display name');
    await dn.fill('E2E User Renamed');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.locator('td', { hasText: 'E2E User Renamed' }).first().waitFor({ timeout: 15_000 });

    // Delete behind a confirm dialog.
    await page.getByRole('button', { name: `Actions for ${upn}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete user' }).click();
    await page.getByText(upn).first().waitFor({ state: 'detached', timeout: 15_000 });

    await page.close();
  }, 60_000);

  it('creates a group and manages membership', async () => {
    const page = await openPortal('/groups');
    const groupName = `E2E Group ${Date.now()}`;

    await page
      .getByRole('button', { name: /New group/ })
      .first()
      .click();
    await page.getByLabel('Display name').fill(groupName);
    await page.getByRole('button', { name: 'Create group' }).click();
    await page.locator('td', { hasText: groupName }).first().waitFor({ timeout: 15_000 });

    // Open Manage members, add the seeded Alice, then remove her.
    const row = page.locator('tr', { hasText: groupName });
    await row.getByRole('button', { name: 'Manage members' }).click();
    await page.getByLabel('Search users to add').fill('alice');
    const addRow = page.locator('.picker-row', { hasText: 'alice@entralocal.dev' });
    await addRow.getByRole('button', { name: 'Add' }).click();

    // The added member now appears in the members list with a Remove control.
    const member = page.locator('.member', { hasText: 'alice@entralocal.dev' });
    await member.getByRole('button', { name: 'Remove' }).click();
    await page.close();
  }, 60_000);

  it('drives the full app lifecycle: redirect URI, scope, role, and a show-once secret', async () => {
    const page = await openPortal('/apps');
    const appName = `E2E App ${Date.now()}`;

    await page
      .getByRole('button', { name: /New app/ })
      .first()
      .click();
    await page.getByLabel('Display name').fill(appName);
    // Confidential so the show-once secret is the realistic path.
    await page.getByRole('switch', { name: 'Confidential client' }).click();
    await page.getByRole('button', { name: 'Create app' }).click();
    await page.getByTestId('msal-snippet').waitFor({ timeout: 30_000 });

    // Redirect URI.
    const redirectSection = page.locator('section', { hasText: 'Redirect URIs' });
    await page.getByLabel('New redirect URI').fill('https://localhost:3000/callback');
    await page.getByLabel('Redirect URI type').selectOption('spa');
    await redirectSection.getByRole('button', { name: 'Add', exact: true }).click();
    await page
      .locator('td', { hasText: 'https://localhost:3000/callback' })
      .first()
      .waitFor({ timeout: 15_000 });

    // Exposed scope.
    const scopeSection = page.locator('section', { hasText: 'Exposed scopes' });
    await page.getByRole('button', { name: /Add scope/ }).click();
    await page.getByLabel('Scope value').fill('access_as_user');
    await scopeSection.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByText('access_as_user').first().waitFor({ timeout: 15_000 });

    // App role.
    const roleSection = page.locator('section', { hasText: 'App roles' });
    await page.getByRole('button', { name: /Add role/ }).click();
    await page.getByLabel('Role value').fill('Tasks.Read');
    await roleSection.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByText('Tasks.Read').first().waitFor({ timeout: 15_000 });

    // Show-once secret: the plaintext appears once in the dialog.
    await page.getByRole('button', { name: /New secret/ }).click();
    await page.getByLabel('Secret description').fill('CI pipeline');
    await page.getByRole('button', { name: 'Create secret' }).click();
    const secretInput = page.getByTestId('secret-value');
    await secretInput.waitFor({ timeout: 15_000 });
    const secretValue = await secretInput.inputValue();
    expect(secretValue.length).toBeGreaterThan(10);

    // Closing the dialog removes the plaintext; it is never shown again.
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByTestId('secret-value').waitFor({ state: 'detached', timeout: 15_000 });
    expect(await page.getByText(secretValue).count()).toBe(0);

    await page.close();
  }, 90_000);

  it('resets the directory behind a confirm dialog and reflects reseeded state', async () => {
    // Create a marker user, then reset; the marker must be gone and the seed must be restored.
    const usersPage = await openPortal('/users');
    const marker = `reset-marker-${Date.now()}@entralocal.dev`;
    await usersPage
      .getByRole('button', { name: /New user/ })
      .first()
      .click();
    await usersPage.getByLabel('User principal name').fill(marker);
    await usersPage.getByLabel('Display name').fill('Reset Marker');
    await usersPage.getByRole('button', { name: 'Create user' }).click();
    await usersPage.getByText(marker).waitFor({ timeout: 15_000 });
    await usersPage.close();

    const dash = await openPortal('/');
    await dash.getByRole('button', { name: /Reset/ }).click();
    await dash.getByRole('button', { name: 'Reset data' }).click();
    // Confirm dialog closes once the reset completes.
    await dash
      .getByRole('button', { name: 'Reset data' })
      .waitFor({ state: 'detached', timeout: 15_000 });
    await dash.close();

    const after = await openPortal('/users');
    await after.getByText('alice@entralocal.dev').first().waitFor({ timeout: 15_000 });
    expect(await after.getByText(marker).count()).toBe(0);
    await after.close();
  }, 90_000);

  it('criterion 7: a portal-created app + its generated MSAL config completes Auth Code + PKCE sign-in', async () => {
    // 1) Reserve the SPA fixture origin and register it through the portal as a redirect URI.
    const spaPort = await getFreePort();
    const spaOrigin = `https://localhost:${spaPort}`;
    const redirectUri = `${spaOrigin}/`;

    const page = await openPortal('/apps');
    const appName = `E2E MSAL App ${Date.now()}`;
    await page
      .getByRole('button', { name: /New app/ })
      .first()
      .click();
    await page.getByLabel('Display name').fill(appName);
    await page.getByRole('button', { name: 'Create app' }).click();
    await page.getByTestId('msal-snippet').waitFor({ timeout: 30_000 });

    await page.getByLabel('New redirect URI').fill(redirectUri);
    await page.getByLabel('Redirect URI type').selectOption('spa');
    await page
      .locator('section', { hasText: 'Redirect URIs' })
      .getByRole('button', { name: 'Add', exact: true })
      .click();
    await page.locator('td', { hasText: redirectUri }).first().waitFor({ timeout: 15_000 });

    // 2) Read the EXACT generated msal-browser config from the portal's snippet panel.
    const snippet = (await page.getByTestId('msal-snippet').textContent()) ?? '';
    const clientId = /clientId:\s*"([^"]+)"/.exec(snippet)?.[1];
    const authority = /authority:\s*"([^"]+)"/.exec(snippet)?.[1];
    const host = /knownAuthorities:\s*\["([^"]+)"\]/.exec(snippet)?.[1];
    const snippetRedirect = /redirectUri:\s*"([^"]+)"/.exec(snippet)?.[1];
    const scopesRaw = /scopes:\s*\[([^\]]+)\]/.exec(snippet)?.[1];
    expect(clientId, 'snippet clientId').toBeTruthy();
    expect(authority).toBe(`${server.origin}/${TENANT}`);
    expect(host).toBe(new URL(server.origin).host);
    expect(snippetRedirect).toBe(redirectUri);
    const scopes = JSON.parse(`[${scopesRaw}]`) as string[];
    expect(scopes).toContain('openid');
    await page.close();

    // 3) Serve a real msal-browser SPA built from that generated config.
    const indexHtml = portalSpaHtml(clientId!, authority!, host!, redirectUri, scopes);
    const msalBundle = readFileSync(
      join(REPO_ROOT, 'node_modules', '@azure', 'msal-browser', 'lib', 'msal-browser.min.js'),
      'utf8',
    );
    const spa = createHttpsServer({ key, cert: ca }, (req, res) => {
      if (req.url && req.url.startsWith('/msal-browser.min.js')) {
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
        res.end(msalBundle);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(indexHtml);
    });
    spaServers.push(spa);
    await new Promise<void>((resolve) => spa.listen(spaPort, '127.0.0.1', resolve));

    // 4) Drive the real Authorization Code + PKCE sign-in, picking the seeded Alice.
    const spaPage = await context.newPage();
    await spaPage.goto(`${spaOrigin}/`, { waitUntil: 'load' });
    await spaPage.waitForSelector('button[name="__el_user"]', { timeout: 30_000 });
    await spaPage.click(`button[name="__el_user"][value="${SEED.userAliceId}"]`);
    await spaPage.waitForFunction(
      () => {
        const r = (globalThis as unknown as { __result?: { status?: string } }).__result;
        return r !== undefined && (r.status === 'done' || r.status === 'error');
      },
      { timeout: 30_000 },
    );
    const result = (await spaPage.evaluate(
      () => (globalThis as unknown as { __result: Record<string, unknown> }).__result,
    )) as {
      status: string;
      error?: string;
      idToken?: string;
      accessToken?: string;
      username?: string;
    };

    expect(result.status, `MSAL error: ${result.error ?? ''}`).toBe('done');
    expect(result.idToken).toBeTruthy();
    expect(result.accessToken).toBeTruthy();
    expect(result.username).toBe('alice@entralocal.dev');

    // 5) The ID token verifies against the live JWKS and is audienced to the PORTAL-created app.
    const { body: discovery } = await httpsGetJson<{ jwks_uri: string; issuer: string }>(
      `${server.origin}/${TENANT}/v2.0/.well-known/openid-configuration`,
    );
    const jwksPath = new URL(discovery.jwks_uri).pathname;
    const { body: jwksDoc } = await httpsGetJson<JSONWebKeySet>(`${server.origin}${jwksPath}`);
    const jwks = createLocalJWKSet(jwksDoc);
    const id = await jwtVerify(result.idToken!, jwks);
    expect(id.payload.iss).toBe(discovery.issuer);
    expect(id.payload.aud).toBe(clientId);
    expect(id.payload.preferred_username).toBe('alice@entralocal.dev');

    await spaPage.close();
  }, 120_000);
});
