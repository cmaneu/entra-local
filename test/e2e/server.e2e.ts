import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/loadConfig.js';
import { createServer, type RunningServer } from '../../src/server.js';
import { browserFlowsEnabled, createMsalNodeClient } from '../helpers/msalDrivers.js';

const TMP_DIR = fileURLToPath(new URL('../../data/.tmp/', import.meta.url));
const certDir = join(TMP_DIR, `e2e-tls-${randomUUID()}`);

let server: RunningServer;
let ca: string;

/** GET over HTTPS trusting the persisted self-signed cert. */
function httpsGet(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET', ca },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Poll /health until ready (e2e readiness gate). */
async function waitForHealth(origin: string, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      if ((await httpsGet(`${origin}/health`)) === 200) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server did not become healthy in time');
}

beforeAll(async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CONFIG_FILE: join(TMP_DIR, `${randomUUID()}.none.json`),
    HOST: 'localhost',
    TLS_ENABLED: 'true',
    TLS_CERT_DIR: certDir,
  });
  server = await createServer({ ...config, port: 0 });
  ca = readFileSync(join(certDir, 'cert.pem'), 'utf8');
});

afterAll(async () => {
  await server?.close();
  rmSync(certDir, { recursive: true, force: true });
});

describe('e2e: server boots over HTTPS and MSAL can target the authority (criterion 11)', () => {
  it('serves /health over HTTPS with the self-signed cert trusted', async () => {
    await waitForHealth(server.origin);
    expect(await httpsGet(`${server.origin}/health`)).toBe(200);
  });

  it('instantiates an @azure/msal-node client against the authority', () => {
    // Authority = <origin>/{tenant}. Full discovery fetch is asserted once #4 lands;
    // here we prove the client can be constructed (no network I/O yet).
    const authority = `${server.origin}/11111111-1111-1111-1111-111111111111`;
    const client = createMsalNodeClient({ authority, caCert: ca });
    expect(client).toBeDefined();
    expect(typeof client.getAuthCodeUrl).toBe('function');
  });

  it('browser (msal-browser/Playwright) flows are wired but gated until #6', () => {
    // Driver code (launchBrowser/browserMsalConfig) is present and typechecks; the actual
    // browser launch is gated behind E2E_BROWSER so #1 stays green without a browser download.
    expect(browserFlowsEnabled()).toBe(false);
  });
});
