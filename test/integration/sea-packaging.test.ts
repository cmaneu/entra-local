import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TMP_DIR } from '../helpers/constants.js';

/**
 * Single-executable (Node SEA) smoke test (#17). Spawns the produced binary against a fresh
 * ephemeral data dir and asserts it boots a real HTTPS server, reports the embedded version at
 * `/health`, serves the embedded portal at `/`, and exposes OIDC discovery — proving the embedded
 * `package-json` + `portal-index-html` assets and the `node:sqlite`-backed startup work in the
 * binary.
 *
 * The suite is GATED on the binary existing (built via `npm run build:sea` / `npm run test:sea`)
 * and on a supported platform, so a bare `npm test` (no binary) skips cleanly without failing.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TENANT = '11111111-1111-1111-1111-111111111111';
const EXE_NAME = process.platform === 'win32' ? 'entra-local.exe' : 'entra-local';
const EXE_PATH = join(REPO_ROOT, 'dist-sea', EXE_NAME);
const SUPPORTED = ['win32', 'linux', 'darwin'].includes(process.platform);
const BINARY_AVAILABLE = SUPPORTED && existsSync(EXE_PATH);

const PKG_VERSION = (
  JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string }
).version;

const dataDir = join(TMP_DIR, `sea-${randomUUID()}`);
const certDir = join(dataDir, 'tls');
const dbPath = join(dataDir, 'entra-local.db');
const noConfigFile = join(dataDir, 'none.config.json');

let child: ChildProcess | undefined;
let origin = '';

/** Reserve a free TCP port for the spawned binary (it cannot tell us an ephemeral one). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** HTTPS GET; trusts the persisted self-signed cert once written, else skips verification. */
function get(path: string): Promise<{ status: number; body: string }> {
  const certPath = join(certDir, 'cert.pem');
  const ca = existsSync(certPath) ? readFileSync(certPath, 'utf8') : undefined;
  const u = new URL(`${origin}${path}`);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'GET',
        ca,
        rejectUnauthorized: ca !== undefined,
      },
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll `/health` until it returns 200 or the deadline passes. */
async function waitForHealthy(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    if (child?.exitCode != null) {
      throw new Error(`binary exited early with code ${child.exitCode}`);
    }
    try {
      const res = await get('/health');
      if (res.status === 200) return;
    } catch (err) {
      lastErr = err;
    }
    await sleep(250);
  }
  throw new Error(`binary did not become healthy in ${timeoutMs}ms: ${String(lastErr)}`);
}

beforeAll(async () => {
  if (!BINARY_AVAILABLE) return;
  mkdirSync(dataDir, { recursive: true });
  const port = await freePort();
  origin = `https://localhost:${port}`;
  child = spawn(EXE_PATH, [], {
    cwd: dataDir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      CONFIG_FILE: noConfigFile,
      HOST: 'localhost',
      PORT: String(port),
      TENANT_ID: TENANT,
      TLS_ENABLED: 'true',
      TLS_CERT_DIR: certDir,
      DB_PATH: dbPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.setEncoding('utf8');
  await waitForHealthy(60_000);
}, 90_000);

afterAll(async () => {
  if (child && child.exitCode == null) {
    child.kill();
    await sleep(250);
  }
  rmSync(dataDir, { recursive: true, force: true });
});

const suite = BINARY_AVAILABLE ? describe : describe.skip;

suite('#17 single-executable binary smoke test', () => {
  it('boots HTTPS and persists a self-signed cert on first run', () => {
    expect(existsSync(join(certDir, 'cert.pem'))).toBe(true);
    expect(existsSync(join(certDir, 'key.pem'))).toBe(true);
  });

  it('GET /health returns 200 with the embedded package.json version', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { status: string; version: string; tls: boolean };
    expect(body.status).toBe('ok');
    expect(body.tls).toBe(true);
    expect(body.version).toBe(PKG_VERSION);
  });

  it('GET / serves the embedded portal HTML', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('<div id="root">');
  });

  it('GET /{tenant}/v2.0/.well-known/openid-configuration returns the discovery doc', async () => {
    const res = await get(`/${TENANT}/v2.0/.well-known/openid-configuration`);
    expect(res.status).toBe(200);
    const doc = JSON.parse(res.body) as { issuer: string; jwks_uri: string };
    expect(doc.issuer).toMatch(/^https:\/\//);
    expect(doc.jwks_uri).toMatch(/^https:\/\//);
  });
});

if (!BINARY_AVAILABLE) {
  describe('#17 single-executable binary smoke test (skipped)', () => {
    it.skip(`binary not built or unsupported platform (${process.platform}); run \`npm run test:sea\``, () => {
      // Intentionally skipped — see suite gating above.
    });
  });
}
