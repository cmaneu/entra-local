import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
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
import { TMP_DIR } from '../helpers/constants.js';

const TENANT = '11111111-1111-1111-1111-111111111111';
let server: RunningServer;
let dbPath: string;
let certDir: string;
let ca: string;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

beforeAll(async () => {
  const port = await freePort();
  dbPath = join(TMP_DIR, `e2e-obo-${randomUUID()}.db`);
  certDir = join(TMP_DIR, `e2e-obo-cert-${randomUUID()}`);
  server = await createServer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      HOST: 'localhost',
      PORT: String(port),
      PUBLIC_ORIGIN: `https://localhost:${port}`,
      TENANT_ID: TENANT,
      TLS_ENABLED: 'true',
      TLS_CERT_DIR: certDir,
      DB_PATH: dbPath,
      CONFIG_FILE: join(TMP_DIR, `${randomUUID()}.none.json`),
    }),
  );
  ca = readFileSync(join(certDir, 'cert.pem'), 'utf8');
}, 60_000);

afterAll(async () => {
  await server?.close();
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  rmSync(certDir, { recursive: true, force: true });
});

function networkClient(): INetworkModule {
  const send = <T>(
    method: 'GET' | 'POST',
    url: string,
    options?: NetworkRequestOptions,
  ): Promise<NetworkResponse<T>> =>
    new Promise((resolve, reject) => {
      const target = new URL(url);
      const data = options?.body;
      const request = httpsRequest(
        {
          hostname: target.hostname,
          port: target.port,
          path: target.pathname + target.search,
          method,
          ca,
          headers: options?.headers,
        },
        (response) => {
          let raw = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (raw += chunk));
          response.on('end', () => {
            const headers: Record<string, string> = {};
            for (const [key, value] of Object.entries(response.headers)) {
              headers[key] = Array.isArray(value) ? value.join(',') : String(value ?? '');
            }
            resolve({
              status: response.statusCode ?? 0,
              headers,
              body: JSON.parse(raw) as T,
            });
          });
        },
      );
      request.on('error', reject);
      if (data) request.write(data);
      request.end();
    });
  return {
    sendGetRequestAsync: (url, options) => send('GET', url, options),
    sendPostRequestAsync: (url, options) => send('POST', url, options),
  };
}

describe('real @azure/msal-node OBO', () => {
  it('acquireTokenOnBehalfOf exchanges a delegated API assertion for Graph', async () => {
    const spa = server.app.store.apps.getByAppId(SEED.appOboSpaId)!;
    const user = server.app.store.users.getById(SEED.userAliceId)!;
    const incoming = await server.app.tokenService.buildTokenResponse({
      app: spa,
      user,
      scopes: [`api://${SEED.appOboApiId}/${SEED.oboApiScopeValue}`],
      audience: SEED.appOboApiId,
      grant: 'authorization_code',
    });

    const authority = `${server.origin}/${TENANT}`;
    const client = new ConfidentialClientApplication({
      auth: {
        clientId: SEED.appOboApiId,
        clientSecret: SEED.oboApiSecret,
        authority,
        knownAuthorities: [new URL(authority).host],
      },
      system: { networkClient: networkClient() },
    });
    const result = await client.acquireTokenOnBehalfOf({
      oboAssertion: incoming.access_token,
      scopes: ['User.Read'],
    });
    expect(result?.accessToken).toBeTruthy();

    const jwksDocument = await networkClient().sendGetRequestAsync<JSONWebKeySet>(
      `${authority}/discovery/v2.0/keys`,
    );
    const jwks = createLocalJWKSet(jwksDocument.body);
    const incomingClaims = (
      await jwtVerify(incoming.access_token, jwks, { issuer: `${authority}/v2.0` })
    ).payload;
    const outgoingClaims = (
      await jwtVerify(result!.accessToken, jwks, { issuer: `${authority}/v2.0` })
    ).payload;
    expect(outgoingClaims).toMatchObject({
      aud: 'https://graph.microsoft.com',
      oid: SEED.userAliceId,
      azp: SEED.appOboApiId,
      appid: SEED.appOboApiId,
      scp: 'User.Read',
    });
    expect(outgoingClaims.oid).toBe(incomingClaims.oid);
  });
});
