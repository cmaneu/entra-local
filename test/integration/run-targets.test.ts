import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/loadConfig.js';
import { createServer, type RunningServer } from '../../src/server.js';
import { certFingerprint } from '../../src/tls/cert.js';
import { TMP_DIR } from '../helpers/constants.js';

/**
 * Run-targets (#14) — the source run target (`npm start`) exercised in-process, plus the
 * shared config/data model both targets depend on. These assertions run everywhere in
 * `npm test` (no Docker required); the Docker-only criteria (3/4/5/6/7) are proven by the
 * `docker` CI job. Covers criterion 1 (boots HTTPS, /health + portal + discovery/JWKS),
 * criterion 2 (persistence across restart), and criterion 8 (one shared model, no branch).
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DOCKERFILE = join(REPO_ROOT, 'Dockerfile');
const PORTAL_INDEX = join(REPO_ROOT, 'portal', 'dist', 'index.html');
const TENANT = '11111111-1111-1111-1111-111111111111';

// Ephemeral per-run data dir (DB + cert), under the repo data/.tmp (never the OS temp dir).
const dataDir = join(TMP_DIR, `run-targets-${randomUUID()}`);
const certDir = join(dataDir, 'tls');
const dbPath = join(dataDir, 'entra-local.db');
const noConfigFile = join(TMP_DIR, `${randomUUID()}.none.json`);

let server: RunningServer;
let ca: string;

/** Minimal HTTPS client trusting the persisted self-signed cert. */
function httpsReq(
  url: string,
  options: { method?: string; body?: string; contentType?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers: Record<string, string> = {};
    if (options.body !== undefined) {
      headers['content-type'] = options.contentType ?? 'application/json';
      headers['content-length'] = String(Buffer.byteLength(options.body));
    }
    const req = httpsRequest(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: options.method ?? 'GET',
        ca,
        headers,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw }));
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

/** Boot a real HTTPS server on an ephemeral port against the shared data dir. */
async function boot(): Promise<RunningServer> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CONFIG_FILE: noConfigFile,
    HOST: 'localhost',
    TENANT_ID: TENANT,
    TLS_ENABLED: 'true',
    TLS_CERT_DIR: certDir,
    DB_PATH: dbPath,
  });
  return createServer({ ...config, port: 0 });
}

beforeAll(async () => {
  // Ensure the real portal bundle exists so the SPA fallback can serve `/` (built by
  // `npm run build`; build it here if a bare `npm test` ran without a prior build).
  if (!existsSync(PORTAL_INDEX)) {
    execFileSync('node', ['scripts/build-portal.mjs'], { cwd: REPO_ROOT, stdio: 'inherit' });
  }
  server = await boot();
  ca = readFileSync(join(certDir, 'cert.pem'), 'utf8');
}, 120_000);

afterAll(async () => {
  await server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('#14 source run target: boots HTTPS and serves the full surface (criterion 1)', () => {
  it('serves /health over HTTPS with 200 {status:"ok", tls:true}', async () => {
    const res = await httpsReq(`${server.origin}/health`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { status: string; tls: boolean; tenantId: string };
    expect(body.status).toBe('ok');
    expect(body.tls).toBe(true);
    expect(body.tenantId).toBe(TENANT);
  });

  it('serves the built admin portal at /', async () => {
    const res = await httpsReq(`${server.origin}/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<div id="root">');
  });

  it('resolves OIDC discovery and JWKS over the same TLS channel', async () => {
    const disc = await httpsReq(`${server.origin}/${TENANT}/v2.0/.well-known/openid-configuration`);
    expect(disc.status).toBe(200);
    const discDoc = JSON.parse(disc.body) as { issuer: string; jwks_uri: string };
    expect(discDoc.issuer).toMatch(/^https:\/\//);

    const jwksPath = new URL(discDoc.jwks_uri).pathname;
    const jwks = await httpsReq(`${server.origin}${jwksPath}`);
    expect(jwks.status).toBe(200);
    const jwksDoc = JSON.parse(jwks.body) as { keys: unknown[] };
    expect(Array.isArray(jwksDoc.keys)).toBe(true);
    expect(jwksDoc.keys.length).toBeGreaterThan(0);
  });
});

describe('#14 persistence across restart — source (criterion 2)', () => {
  it('keeps admin-API data + the same cert fingerprint after a stop/start', async () => {
    const marker = `run-targets-app-${randomUUID()}`;
    const created = await httpsReq(`${server.origin}/admin/api/apps`, {
      method: 'POST',
      body: JSON.stringify({ displayName: marker, isConfidential: false }),
    });
    expect(created.status).toBe(201);

    const fingerprintBefore = certFingerprint(readFileSync(join(certDir, 'cert.pem'), 'utf8'));

    // Stop, then start a fresh server against the SAME DB_PATH + TLS_CERT_DIR.
    await server.close();
    server = await boot();
    ca = readFileSync(join(certDir, 'cert.pem'), 'utf8');

    const fingerprintAfter = certFingerprint(readFileSync(join(certDir, 'cert.pem'), 'utf8'));
    expect(fingerprintAfter).toBe(fingerprintBefore);

    const list = await httpsReq(`${server.origin}/admin/api/apps?search=${marker}`);
    expect(list.status).toBe(200);
    const page = JSON.parse(list.body) as { value: { displayName: string }[] };
    expect(page.value.some((a) => a.displayName === marker)).toBe(true);
  });
});

describe('#14 shared config/data model — no target-specific branch (criterion 8)', () => {
  it('both targets resolve the same data/ layout from the same loadConfig', () => {
    // Source defaults (no DB/cert env) and the container shape (HOST=0.0.0.0) produce the
    // identical data/ layout — only HOST differs, exactly as the spec mandates.
    const source = loadConfig({ NODE_ENV: 'production', CONFIG_FILE: noConfigFile });
    const container = loadConfig({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      CONFIG_FILE: noConfigFile,
    });

    expect(source.dbPath).toBe('./data/entra-local.db');
    expect(source.tls.certDir).toBe('./data/tls');
    expect(container.dbPath).toBe(source.dbPath);
    expect(container.tls.certDir).toBe(source.tls.certDir);
    expect(source.host).toBe('localhost');
    expect(container.host).toBe('0.0.0.0');
  });

  it('the Dockerfile reuses the shared model (HOST=0.0.0.0, same entrypoint + volume, no branch)', () => {
    const dockerfile = readFileSync(DOCKERFILE, 'utf8');
    expect(dockerfile).toMatch(/HOST=0\.0\.0\.0/);
    expect(dockerfile).toMatch(/PORT=8443/);
    expect(dockerfile).toMatch(/CMD \["node", "dist\/index\.js"\]/);
    expect(dockerfile).toMatch(/VOLUME \["\/app\/data"\]/);
    expect(dockerfile).toMatch(/HEALTHCHECK/);
    expect(dockerfile).toMatch(/USER node/);
    // No target-specific config branch: the image must not pin DB_PATH / TLS_CERT_DIR to a
    // container-only path — both default under ./data (the volume mount), same as source.
    expect(dockerfile).not.toMatch(/ENV\s+DB_PATH/);
    expect(dockerfile).not.toMatch(/ENV\s+TLS_CERT_DIR/);
  });
});
