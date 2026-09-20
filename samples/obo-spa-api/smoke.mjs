import { chromium } from 'playwright';

const spaUrl = process.env.SMOKE_SPA_URL ?? 'http://localhost:5174';
const apiUrl = process.env.SMOKE_API_URL ?? 'http://localhost:4001';
const spaId = 'cccccccc-0000-0000-0000-000000000008';
const apiId = 'cccccccc-0000-0000-0000-000000000009';
const graph = 'https://graph.microsoft.com';
const bobId = 'aaaaaaaa-0000-0000-0000-000000000002';
const tenantId = '11111111-1111-1111-1111-111111111111';
const emulatorOrigin = 'https://localhost:8443';

function check(value, message) {
  if (!value) throw new Error(message);
  console.log(`✓ ${message}`);
}

async function callApi(token) {
  const headers = token ? { Authorization: ['Bearer', token].join(' ') } : {};
  const response = await fetch(`${apiUrl}/api/me`, { headers });
  return { status: response.status, body: await response.json() };
}

async function appOnlyApiToken() {
  const response = await fetch(`${emulatorOrigin}/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: apiId,
      client_secret: 'obo-middle-tier-secret',
      scope: `${apiId}/.default`,
    }),
  });
  check(response.ok, 'obtained a valid API-audience token without delegated scope');
  return (await response.json()).access_token;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();

try {
  check((await fetch(`${apiUrl}/health`).then((r) => r.json())).status === 'ok', 'API is healthy');
  await page.goto(spaUrl);
  await page.click('[data-testid="signin"]');
  await page.waitForSelector('button[name="__el_user"]');
  await page.click(`button[name="__el_user"][value="${bobId}"]`);
  await page.waitForFunction(() => window.__smoke?.signedIn === true);

  await page.click('[data-testid="call-api"]');
  await page.waitForFunction(() => window.__smoke?.status === 200);
  const state = await page.evaluate(() => window.__smoke);
  const result = state.result;
  check(result?.incoming?.aud === apiId, 'incoming aud is the middle-tier API');
  check(result?.incoming?.azp === spaId, 'incoming azp is the SPA');
  check(
    String(result?.incoming?.scp ?? '').split(' ').includes('access_as_user'),
    'incoming scope contains access_as_user',
  );
  check(result?.downstream?.aud === graph, 'downstream aud is Graph');
  check(result?.downstream?.azp === apiId, 'downstream azp is the middle tier');
  check(result?.downstream?.appid === apiId, 'downstream appid is the middle tier');
  check(result?.downstream?.scp === 'User.Read', 'downstream scope is User.Read');
  check(result?.oidContinuity === true, 'user oid is continuous across both tokens');
  check(result?.profile?.id === bobId, 'Graph /me returns the selected user');
  check(!JSON.stringify(result).includes('access_token'), 'API response does not expose a token');

  check((await callApi()).status === 401, 'missing token returns 401');
  check((await callApi('not.a.jwt')).status === 401, 'invalid token returns 401');
  const wrongScopeToken = await appOnlyApiToken();
  check((await callApi(wrongScopeToken)).status === 403, 'wrong-scope token returns 403');
  console.log('OBO SAMPLE SMOKE PASSED');
} finally {
  await context.close();
  await browser.close();
}
