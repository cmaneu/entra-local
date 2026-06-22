import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/loadConfig.js';
import { resolveTlsMaterial, certFingerprint } from '../../src/tls/cert.js';
import { createServer, type RunningServer } from '../../src/server.js';
import { TMP_DIR } from '../helpers/constants.js';

const cleanup: string[] = [];
let server: RunningServer | undefined;

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpCertDir(): string {
  const dir = join(TMP_DIR, `tls-${randomUUID()}`);
  cleanup.push(dir);
  return dir;
}

/** Minimal env that resolves to defaults, with a guaranteed-absent config file. */
function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CONFIG_FILE: join(TMP_DIR, `${randomUUID()}.none.json`),
    ...overrides,
  };
}

/** Loaded config with an ephemeral listen port (0) for parallel-safe real boots. */
function ephemeral(config: ReturnType<typeof loadConfig>) {
  return { ...config, port: 0 };
}

/** GET over HTTPS trusting the supplied CA (proves the self-signed cert is trustable). */
function httpsGet(url: string, ca: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET', ca },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('TLS auto-generation + stability (criterion 4)', () => {
  it('generates, persists, and reloads the same cert (stable fingerprint)', () => {
    const certDir = tmpCertDir();
    const config = loadConfig(env({ TLS_CERT_DIR: certDir }));

    const first = resolveTlsMaterial(config);
    expect(first).not.toBeNull();
    expect(existsSync(join(certDir, 'cert.pem'))).toBe(true);
    expect(existsSync(join(certDir, 'key.pem'))).toBe(true);

    const second = resolveTlsMaterial(config);
    expect(second).not.toBeNull();
    expect(certFingerprint(first!.cert)).toBe(certFingerprint(second!.cert));
    expect(first!.cert).toBe(second!.cert);
  });

  it('restricts key-file permissions (best-effort on Windows)', () => {
    const certDir = tmpCertDir();
    const config = loadConfig(env({ TLS_CERT_DIR: certDir }));
    resolveTlsMaterial(config);
    const keyStat = statSync(join(certDir, 'key.pem'));
    if (process.platform !== 'win32') {
      expect(keyStat.mode & 0o077).toBe(0); // no group/other access
    } else {
      expect(keyStat.size).toBeGreaterThan(0); // chmod is a no-op on Windows
    }
  });

  it('serves /health over real HTTPS with the generated cert trusted', async () => {
    const certDir = tmpCertDir();
    const config = loadConfig(env({ TLS_CERT_DIR: certDir, HOST: 'localhost' }));
    server = await createServer(ephemeral(config));

    const ca = readFileSync(join(certDir, 'cert.pem'), 'utf8');
    const res = await httpsGet(`${server.origin}/health`, ca);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).tls).toBe(true);
  });
});

describe('TLS override (criterion 5)', () => {
  it('uses provided TLS_CERT/TLS_KEY when both are set', () => {
    // Generate a cert pair to act as the "provided" custom cert.
    const srcDir = tmpCertDir();
    const seed = resolveTlsMaterial(loadConfig(env({ TLS_CERT_DIR: srcDir })));
    const certPath = join(srcDir, 'custom-cert.pem');
    const keyPath = join(srcDir, 'custom-key.pem');
    writeFileSync(certPath, seed!.cert);
    writeFileSync(keyPath, seed!.key);

    const config = loadConfig(env({ TLS_CERT: certPath, TLS_KEY: keyPath }));
    const material = resolveTlsMaterial(config);
    expect(material!.cert).toBe(seed!.cert);
    expect(material!.key).toBe(seed!.key);
  });

  it('fails config validation when only one of cert/key is set', () => {
    expect(() => loadConfig(env({ TLS_CERT: './only-cert.pem' }))).toThrow();
  });
});

describe('HTTP fallback (criterion 6)', () => {
  it('serves /health over plain HTTP when TLS_ENABLED=false', async () => {
    const config = loadConfig(env({ TLS_ENABLED: 'false', HOST: 'localhost' }));
    expect(resolveTlsMaterial(config)).toBeNull();

    server = await createServer(ephemeral(config));
    expect(server.origin.startsWith('http://')).toBe(true);

    const res = await fetch(`${server.origin}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tls: boolean };
    expect(body.tls).toBe(false);
  });
});
