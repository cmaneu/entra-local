import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ConfidentialClientApplication,
  type INetworkModule,
  type NetworkRequestOptions,
  type NetworkResponse,
} from '@azure/msal-node';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/loadConfig.js';
import { createServer, type RunningServer } from '../../src/server.js';
import { SEED } from '../../src/store/seed.js';

/**
 * Real-MSAL client-credentials end-to-end (feature #8, criterion 8). An `@azure/msal-node`
 * `ConfidentialClientApplication` calls `acquireTokenByClientCredential({ scopes:['<res>/.default']})`
 * against the running emulator over real HTTPS (trusting the emulator's self-signed cert via a
 * custom network module) and receives a JWKS-verifiable **app-only** access token with the expected
 * `aud`/`roles`/`sub`. Asserted for both the daemon's own `api://<appId>/.default` (roles granted)
 * and Graph `.default` (roles empty).
 */

const TMP_DIR = fileURLToPath(new URL('../../data/.tmp/', import.meta.url));
const TENANT = '11111111-1111-1111-1111-111111111111';
const DAEMON = SEED.appDaemonId;
const DAEMON_URI = `api://${DAEMON}`;
const GRAPH = 'https://graph.microsoft.com';

let server: RunningServer;
let ca: string;
let authority: string;
const certDir = join(TMP_DIR, `e2e-cc-${randomUUID()}`);

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
    DB_PATH: join(TMP_DIR, `e2e-cc-${randomUUID()}.db`),
  });
  server = await createServer(config);
  ca = readFileSync(join(certDir, 'cert.pem'), 'utf8');
  authority = `${server.origin}/${TENANT}`;
}, 60_000);

afterAll(async () => {
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

/** Build a confidential client for the seeded daemon, trusting the emulator's cert. */
function daemonClient(): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: DAEMON,
      authority,
      knownAuthorities: [new URL(authority).host],
      clientSecret: SEED.daemonSecret,
    },
    system: { networkClient: caNetworkModule(ca) },
  });
}

describe('real-MSAL client-credentials e2e (criterion 8)', () => {
  it('acquireTokenByClientCredential for the daemon app_id_uri yields an app-only token with roles', async () => {
    const cca = daemonClient();
    const result = await cca.acquireTokenByClientCredential({
      scopes: [`${DAEMON_URI}/.default`],
    });

    expect(result, 'msal-node returned no result').not.toBeNull();
    expect(result!.accessToken).toBeTruthy();
    // App-only: no user account is associated with a client-credentials token.
    expect(result!.account).toBeNull();

    const jwks = await liveJwks();
    const { payload } = await jwtVerify(result!.accessToken, jwks);
    expect(payload.aud).toBe(DAEMON_URI);
    expect(payload.sub).toBe(DAEMON);
    expect(payload.appid).toBe(DAEMON);
    expect(payload.azp).toBe(DAEMON);
    expect(payload.roles).toContain(SEED.daemonRoleValue); // Tasks.Read.All
    expect(payload.ver).toBe('2.0');
    expect(payload.oid).toBeUndefined();
    expect(payload.scp).toBeUndefined();
  }, 60_000);

  it('acquireTokenByClientCredential for Graph .default yields aud=Graph with roles=[]', async () => {
    const cca = daemonClient();
    const result = await cca.acquireTokenByClientCredential({
      scopes: [`${GRAPH}/.default`],
    });

    expect(result, 'msal-node returned no result').not.toBeNull();
    const jwks = await liveJwks();
    const { payload } = await jwtVerify(result!.accessToken, jwks);
    expect(payload.aud).toBe(GRAPH);
    expect(payload.sub).toBe(DAEMON);
    expect(payload.roles).toEqual([]);
  }, 60_000);
});
