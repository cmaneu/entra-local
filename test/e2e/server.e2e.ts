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

/** GET over HTTPS returning the parsed JSON body (trusting the self-signed cert). */
function httpsGetJson<T>(url: string): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET', ca },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
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

  it('fetches and parses the OIDC discovery document over TLS (#4)', async () => {
    await waitForHealth(server.origin);
    const tenant = '11111111-1111-1111-1111-111111111111';
    const { status, body } = await httpsGetJson<Record<string, unknown>>(
      `${server.origin}/${tenant}/v2.0/.well-known/openid-configuration`,
    );
    expect(status).toBe(200);

    // The document parses and advertises absolute https URLs for the issuer + core endpoints.
    // (URLs derive from the configured PUBLIC_ORIGIN, which is independent of the ephemeral
    // test port — so we assert path suffixes rather than the exact origin.)
    expect(typeof body.issuer).toBe('string');
    expect(body.issuer as string).toMatch(/^https:\/\//);
    expect(body.issuer as string).toMatch(new RegExp(`/${tenant}/v2\\.0$`));
    expect(body.authorization_endpoint as string).toMatch(
      new RegExp(`/${tenant}/oauth2/v2\\.0/authorize$`),
    );
    expect(body.token_endpoint as string).toMatch(new RegExp(`/${tenant}/oauth2/v2\\.0/token$`));
    expect(body.jwks_uri as string).toMatch(new RegExp(`/${tenant}/discovery/v2\\.0/keys$`));
    expect(body.response_modes_supported).toEqual(['query', 'fragment', 'form_post']);

    // The live JWKS endpoint (at the actual bound origin) returns a JWK Set over the same TLS
    // channel — proving the advertised jwks_uri path resolves to a real key set.
    const jwksPath = new URL(body.jwks_uri as string).pathname;
    const jwks = await httpsGetJson<{ keys: unknown[] }>(`${server.origin}${jwksPath}`);
    expect(jwks.status).toBe(200);
    expect(Array.isArray(jwks.body.keys)).toBe(true);
  });

  it('browser (msal-browser/Playwright) flows are wired but gated until #6', () => {
    // Driver code (launchBrowser/browserMsalConfig) is present and typechecks; the actual
    // browser launch is gated behind E2E_BROWSER so #1 stays green without a browser download.
    expect(browserFlowsEnabled()).toBe(false);
  });
});
