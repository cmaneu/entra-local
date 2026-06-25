import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PublicClientApplication,
  type Configuration,
  type INetworkModule,
  type NetworkRequestOptions,
  type NetworkResponse,
} from '@azure/msal-node';

/**
 * Entra Local — Device Authorization Grant CLI sample (feature #19, RFC 8628).
 *
 * A headless/console app cannot pop a browser, so it uses the **device code** flow:
 *   1. `@azure/msal-node` `PublicClientApplication.acquireTokenByDeviceCode` requests a
 *      `device_code` + a short human `user_code` from the emulator and prints a verification URL.
 *   2. The user opens that URL in any browser, enters the code, and signs in (picks a seeded user).
 *   3. MSAL polls the token endpoint until the request is approved, then returns an access token.
 *   4. The CLI decodes the token's claims and calls `GET /graph/v1.0/me` with it.
 *
 * The client is the seeded **public** app `cccccccc-…-0001` ("Sample SPA") — public clients have no
 * secret, which is exactly what a distributable CLI needs. Requesting the Graph delegated scope
 * `User.Read` makes the emulator mint a token with `aud = https://graph.microsoft.com`, so the
 * built-in Graph `/me` endpoint accepts it. A successful `/me` response is itself proof that the
 * token validated against the emulator's live JWKS (signature / issuer / audience).
 *
 * Every value is environment-overridable so the sample also runs against a non-default emulator
 * (different host/port, tenant, or client app) without code changes.
 */

const EMULATOR_ORIGIN = (process.env.EMULATOR_ORIGIN ?? 'https://localhost:8443').replace(/\/$/, '');
const TENANT_ID = process.env.TENANT_ID ?? '11111111-1111-1111-1111-111111111111';
const CLIENT_ID = process.env.CLIENT_ID ?? 'cccccccc-0000-0000-0000-000000000001';
const SCOPE = process.env.SCOPE ?? 'User.Read';
const AUTHORITY = `${EMULATOR_ORIGIN}/${TENANT_ID}`;
const GRAPH_ME_URL = `${EMULATOR_ORIGIN}/graph/v1.0/me`;

/**
 * Resolve and read the emulator's self-signed dev certificate so the CLI's HTTPS calls trust it.
 *
 * Precedence: `EMULATOR_CA_CERT` → `NODE_EXTRA_CA_CERTS` (the standard msal-node recipe) → the
 * emulator's default `data/tls/cert.pem` at the repo root. Returns `undefined` when no cert file is
 * found, in which case the CLI falls back to Node's default trust store (so it still works against,
 * say, a publicly trusted emulator deployment or when `NODE_EXTRA_CA_CERTS` was exported before Node
 * started).
 */
function loadCaCert(): string | undefined {
  const override = process.env.EMULATOR_CA_CERT ?? process.env.NODE_EXTRA_CA_CERTS;
  // This file lives at samples/node-cli/src/cli.ts; the repo root is three levels up.
  const here = dirname(fileURLToPath(import.meta.url));
  const path =
    override != null && override.trim() !== ''
      ? resolve(override.trim())
      : resolve(here, '../../../data/tls/cert.pem');
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

const CA = loadCaCert();

/**
 * A minimal MSAL network module that issues the device-code + token HTTP calls over Node's `https`
 * with the emulator CA explicitly trusted. MSAL otherwise relies on the process-global trust store,
 * which cannot be amended after startup; trusting the CA here makes the sample work out of the box.
 */
function caNetworkModule(caCert: string): INetworkModule {
  const send = <T>(
    method: 'GET' | 'POST',
    url: string,
    options?: NetworkRequestOptions,
  ): Promise<NetworkResponse<T>> =>
    new Promise((resolveReq, rejectReq) => {
      const u = new URL(url);
      const data = options?.body;
      const req = httpsRequest(
        {
          hostname: u.hostname,
          port: u.port || 443,
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
            resolveReq({ headers, body: body as T, status: res.statusCode ?? 0 });
          });
        },
      );
      req.on('error', rejectReq);
      if (data) req.write(data);
      req.end();
    });
  return {
    sendGetRequestAsync: (url, options) => send('GET', url, options),
    sendPostRequestAsync: (url, options) => send('POST', url, options),
  };
}

/** GET a JSON resource over HTTPS with a Bearer token (trusting the emulator CA when available). */
function graphGet(
  url: string,
  bearer: string,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolveReq, rejectReq) => {
    const u = new URL(url);
    const req = httpsRequest(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'GET',
        ...(CA ? { ca: CA } : {}),
        headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let body: unknown = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            /* leave as raw string */
          }
          resolveReq({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', rejectReq);
    req.end();
  });
}

/**
 * Decode a JWT's payload **without** verifying its signature. A client only needs to read the
 * minted token's claims for display; verifying the access token is the resource server's job (the
 * emulator does it when the CLI calls `/me`). Never trust unverified claims for authorization.
 */
function decodeJwtClaims(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1];
  if (!part) return {};
  const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const config: Configuration = {
    auth: {
      clientId: CLIENT_ID,
      authority: AUTHORITY,
      // Mark the GUID authority known so MSAL skips (online) instance discovery — the emulator is
      // offline-only.
      knownAuthorities: [new URL(AUTHORITY).host],
    },
    // Trust the emulator's self-signed cert for MSAL's HTTPS calls when we found one.
    ...(CA ? { system: { networkClient: caNetworkModule(CA) } } : {}),
  };

  const pca = new PublicClientApplication(config);

  console.log('Entra Local — device-code CLI sample');
  console.log(`  authority: ${AUTHORITY}`);
  console.log(`  client_id: ${CLIENT_ID}`);
  console.log(`  scope:     ${SCOPE}`);
  console.log('');

  const result = await pca.acquireTokenByDeviceCode({
    scopes: [SCOPE],
    deviceCodeCallback: (response) => {
      // Human-facing instruction (MSAL composes the full message including URL + code) …
      console.log(response.message);
      // … plus machine-parseable lines so the CI smoke can drive approval headlessly.
      console.log('');
      console.log(`VERIFICATION_URI=${response.verificationUri}`);
      console.log(`USER_CODE=${response.userCode}`);
      console.log('');
      console.log('Waiting for you to approve in the browser…');
    },
  });

  if (!result) {
    console.error('Device-code sign-in returned no result.');
    process.exitCode = 1;
    return;
  }

  const claims = decodeJwtClaims(result.accessToken);
  console.log('');
  console.log('Signed in.');
  console.log(`  account:  ${result.account?.username ?? '(unknown)'}`);
  console.log('Access-token claims:');
  console.log(`  aud=${String(claims.aud ?? '')}`);
  console.log(`  scp=${String(claims.scp ?? '')}`);
  console.log(`  oid=${String(claims.oid ?? '')}`);
  console.log(`  tid=${String(claims.tid ?? '')}`);
  console.log(`  appid=${String(claims.appid ?? '')}`);

  console.log('');
  console.log(`Calling GET ${GRAPH_ME_URL} …`);
  const me = await graphGet(GRAPH_ME_URL, result.accessToken);
  console.log(`  status: ${me.status}`);
  console.log(`  body:   ${JSON.stringify(me.body)}`);

  if (me.status !== 200) {
    console.error('Graph /me did not return 200 — see body above.');
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error('Device-code CLI failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
