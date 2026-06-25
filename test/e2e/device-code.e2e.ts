import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/loadConfig.js';
import { createServer, type RunningServer } from '../../src/server.js';
import { SEED } from '../../src/store/seed.js';

/**
 * Real-MSAL device-code end-to-end (feature #15, criterion 19). `@azure/msal-node`
 * `acquireTokenByDeviceCode` requests a device + user code at `/devicecode`, then polls `/token`
 * with `grant_type=urn:ietf:params:oauth:grant-type:device_code`. The human approval is driven
 * headlessly from inside `deviceCodeCallback` via a cookie-jar HTTPS sequence
 * (lookup → signin(account-picker, Alice) → decide=approve). The acquire + approval promises are
 * awaited together so a failed approval fails fast. The minted access token is asserted
 * JWKS-verifiable with the approving user's identity.
 */

const TMP_DIR = fileURLToPath(new URL('../../data/.tmp/', import.meta.url));
const TENANT = '11111111-1111-1111-1111-111111111111';
const SPA_SCOPE = `api://${SEED.appSpaId}/${SEED.spaScopeValue}`;
const SCOPES = ['openid', 'profile', SPA_SCOPE];

let server: RunningServer;
let ca: string;
let authority: string;
const certDir = join(TMP_DIR, `e2e-device-${randomUUID()}`);

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

/** POST a form (x-www-form-urlencoded) over HTTPS with a cookie jar; returns status/body and updates the jar. */
function postForm(
  url: string,
  fields: Record<string, string>,
  jar: Map<string, string>,
): Promise<{ status: number; body: string; setCookie: string[] }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = new URLSearchParams(fields).toString();
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const req = httpsRequest(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        ca,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(data),
          ...(cookie ? { cookie } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'] ?? [];
          for (const sc of setCookie) {
            const pair = sc.split(';')[0] ?? '';
            const eq = pair.indexOf('=');
            if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
          }
          resolve({ status: res.statusCode ?? 0, body: raw, setCookie });
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/** Extract the signed `__el_state` hidden input value from an HTML form. */
function extractState(html: string): string {
  const m = /name="__el_state" value="([^"]+)"/.exec(html);
  if (!m?.[1]) throw new Error(`__el_state not found in response: ${html.slice(0, 200)}`);
  return m[1];
}

/**
 * Drive the human approval headlessly: lookup the user code (→ account picker), sign in as Alice
 * (sets `el_session`), then approve. Throws on any unexpected status so the flow fails fast.
 */
async function approveAsAlice(userCode: string): Promise<void> {
  const verify = `${server.origin}/${TENANT}/oauth2/v2.0/devicecode/verify`;
  const jar = new Map<string, string>();

  const lookup = await postForm(verify, { __el_step: 'lookup', user_code: userCode }, jar);
  if (lookup.status !== 200 || !lookup.body.includes('name="__el_user"')) {
    throw new Error(`lookup failed (${lookup.status}): ${lookup.body.slice(0, 200)}`);
  }

  const signin = await postForm(
    verify,
    {
      __el_step: 'signin',
      user_code: userCode,
      __el_state: extractState(lookup.body),
      __el_user: SEED.userAliceId,
    },
    jar,
  );
  if (signin.status !== 200 || !signin.setCookie[0]?.startsWith('el_session=')) {
    throw new Error(`signin failed (${signin.status}); set-cookie=${signin.setCookie.join('|')}`);
  }

  const decide = await postForm(
    verify,
    { __el_step: 'decide', __el_state: extractState(signin.body), __el_decision: 'approve' },
    jar,
  );
  if (decide.status !== 200 || !decide.body.includes('all set')) {
    throw new Error(`approve failed (${decide.status}): ${decide.body.slice(0, 200)}`);
  }
}

beforeAll(async () => {
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
    REQUIRE_PASSWORD: 'false',
    DB_PATH: join(TMP_DIR, `e2e-device-${randomUUID()}.db`),
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

describe('real-MSAL device-code e2e (criterion 19)', () => {
  it('@azure/msal-node acquireTokenByDeviceCode mints a JWKS-verifiable token after headless approval', async () => {
    const pca = new PublicClientApplication({
      auth: {
        clientId: SEED.appSpaId,
        authority,
        knownAuthorities: [new URL(authority).host],
      },
      system: { networkClient: caNetworkModule(ca) },
    });

    let approvalPromise: Promise<void> | undefined;
    let approvalStarted!: () => void;
    const approvalReady = new Promise<void>((resolve) => {
      approvalStarted = resolve;
    });

    const acquirePromise = pca.acquireTokenByDeviceCode({
      scopes: SCOPES,
      deviceCodeCallback: (response: { userCode: string }) => {
        approvalPromise = approveAsAlice(response.userCode);
        approvalStarted();
      },
    });

    await approvalReady;
    const [result] = await Promise.all([acquirePromise, approvalPromise]);

    expect(result, 'msal-node returned no result').not.toBeNull();
    expect(result!.accessToken).toBeTruthy();
    expect(result!.account?.username).toBe('alice@entralocal.dev');
    expect(result!.account?.homeAccountId).toContain(SEED.userAliceId);

    const jwks = await liveJwks();
    const access = await jwtVerify(result!.accessToken, jwks);
    expect(access.payload.scp).toContain(SEED.spaScopeValue);
    expect(access.payload.aud).toBe(SEED.appSpaId);
  }, 90_000);
});
