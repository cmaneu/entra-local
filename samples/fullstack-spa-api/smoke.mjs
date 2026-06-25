// CI smoke for the full-stack SPA + API sample (feature #24).
//
// Assumes three services are ALREADY running (the CI job / local docs start them):
//   - emulator: https://localhost:8443  (seeded)
//   - API:      http://localhost:4000   (trusts the emulator dev cert automatically for the JWKS fetch)
//   - SPA:      http://localhost:5173   (vite dev or preview)
//
// It drives a real @azure/msal-browser sign-in with Playwright, then asserts:
//   1. GET /api/todos → 200 with a token whose aud = API app and scp contains access_as_user;
//   2. GET /api/todos with no token and with a garbage token → 401;
//   3. GET /api/todos with a valid-audience token that LACKS the scope (api://API/.default) → 403.
//
// Playwright is resolved from the repo-root node_modules, so run this from the repo root:
//   node samples/fullstack-spa-api/smoke.mjs
//
// Exit code 0 = all assertions passed; non-zero = failure (details on stderr).

import { chromium } from 'playwright';

const SPA_URL = process.env.SMOKE_SPA_URL ?? 'http://localhost:5173';
const API_URL = process.env.SMOKE_API_URL ?? 'http://localhost:4000';
const API_APP_ID = process.env.SMOKE_API_APP_ID ?? 'cccccccc-0000-0000-0000-000000000005';
const ALICE_ID = process.env.SMOKE_ALICE_ID ?? 'aaaaaaaa-0000-0000-0000-000000000001';
const API_SCOPE = `api://${API_APP_ID}/access_as_user`;
const API_ADMIN_SCOPE = `api://${API_APP_ID}/access_as_admin`;

const failures = [];
function check(cond, message) {
  if (cond) {
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ ${message}`);
    failures.push(message);
  }
}

function decodeJwtPayload(token) {
  const part = token.split('.')[1];
  const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json);
}

async function callTodos(token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_URL}/api/todos`, { headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* ignore non-JSON */
  }
  return { status: res.status, body };
}

async function main() {
  // The API health probe must be up before we begin.
  const health = await fetch(`${API_URL}/health`).then((r) => r.json());
  check(health.status === 'ok', 'API /health returns ok');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  try {
    await page.goto(SPA_URL, { waitUntil: 'load' });

    // Start the redirect sign-in.
    await page.click('[data-testid="signin"]');

    // Emulator account picker → choose Alice (no password when REQUIRE_PASSWORD is false).
    await page.waitForSelector('button[name="__el_user"]', { timeout: 30_000 });
    await page.click(`button[name="__el_user"][value="${ALICE_ID}"]`);

    // Back on the SPA, wait until MSAL has completed sign-in.
    await page.waitForFunction(() => window.__smoke && window.__smoke.signedIn === true, {
      timeout: 30_000,
    });
    check(true, 'completed interactive sign-in via the SPA');

    // 1) Happy path: acquire a real API token and call the protected route.
    const validToken = await page.evaluate((scope) => window.__acquireToken(scope), API_SCOPE);
    const validClaims = decodeJwtPayload(validToken);
    check(validClaims.aud === API_APP_ID, `access token aud = API app (${API_APP_ID})`);
    check(
      String(validClaims.scp ?? '')
        .split(' ')
        .includes('access_as_user'),
      'access token scp contains access_as_user',
    );

    const ok = await callTodos(validToken);
    check(ok.status === 200, 'GET /api/todos with valid token → 200');
    check(Array.isArray(ok.body?.todos) && ok.body.todos.length > 0, 'API returned todos');
    check(ok.body?.caller?.aud === API_APP_ID, 'API echoed caller aud = API app');

    // 2) 401 negative cases.
    const noToken = await callTodos(null);
    check(noToken.status === 401, 'GET /api/todos with no token → 401');
    const garbage = await callTodos('not.a.valid.jwt');
    check(garbage.status === 401, 'GET /api/todos with garbage token → 401');

    // 3) 403: a token with the right audience but lacking the required scope. The SPA was granted
    //    `access_as_admin` at sign-in; re-minting an admin-only token (forceRefresh narrows the
    //    refresh-token grant) yields `aud`=API app but `scp` WITHOUT `access_as_user`.
    const adminToken = await page.evaluate(
      (scope) => window.__acquireToken(scope, true),
      API_ADMIN_SCOPE,
    );
    const adminClaims = decodeJwtPayload(adminToken);
    check(adminClaims.aud === API_APP_ID, 'admin-scope token aud = API app');
    check(
      !String(adminClaims.scp ?? '')
        .split(' ')
        .includes('access_as_user'),
      'admin-scope token does NOT contain access_as_user',
    );
    const forbidden = await callTodos(adminToken);
    check(forbidden.status === 403, 'GET /api/todos with wrong-scope token → 403');
  } finally {
    await context.close();
    await browser.close();
  }
}

main()
  .then(() => {
    if (failures.length > 0) {
      console.error(`\nSMOKE FAILED: ${failures.length} assertion(s) failed.`);
      process.exit(1);
    }
    console.log('\nSMOKE PASSED');
  })
  .catch((err) => {
    console.error('\nSMOKE ERRORED:', err);
    process.exit(1);
  });
