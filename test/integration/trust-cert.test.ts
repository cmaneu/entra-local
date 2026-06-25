import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/loadConfig.js';
import { certFingerprint, certThumbprint, resolveCertPath } from '../../src/tls/cert.js';
import { runTrust } from '../../src/cli/trust.js';
import { runCli } from '../../src/cli/index.js';
import { TMP_DIR } from '../helpers/constants.js';

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpCertDir(): string {
  const dir = join(TMP_DIR, `trust-${randomUUID()}`);
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

/** Run a fn with process.env temporarily set to a clean test env, restoring afterwards. */
async function withEnv(
  overrides: Record<string, string>,
  fn: () => Promise<void> | void,
): Promise<void> {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env(overrides));
  try {
    await fn();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

describe('resolveCertPath + thumbprint (criterion 1/6)', () => {
  it('generates and returns the cert path on first call', () => {
    const certDir = tmpCertDir();
    const config = loadConfig(env({ TLS_CERT_DIR: certDir }));

    const path = resolveCertPath(config);
    expect(path.endsWith('cert.pem')).toBe(true);
    expect(existsSync(path)).toBe(true);

    // Thumbprint is the colon-free SHA-1 of the same PEM.
    const thumb = certThumbprint(readFileSync(path, 'utf8'));
    expect(thumb).toMatch(/^[0-9A-F]+$/i);
    expect(thumb).not.toContain(':');
  });

  it('throws a clean error when TLS is disabled', () => {
    const config = loadConfig(env({ TLS_ENABLED: 'false' }));
    expect(() => resolveCertPath(config)).toThrow(/TLS is disabled/);
  });
});

describe('runTrust print mode (criterion 3)', () => {
  it('prints the platform trust command and the NODE_EXTRA_CA_CERTS hint', () => {
    const certDir = tmpCertDir();
    const config = loadConfig(env({ TLS_CERT_DIR: certDir }));
    const lines: string[] = [];

    runTrust({ config, action: 'install', apply: false, out: (m) => lines.push(m), plat: 'win32' });

    const text = lines.join('\n');
    expect(text).toContain('certutil');
    expect(text).toContain('-addstore');
    expect(text).toContain('NODE_EXTRA_CA_CERTS');
  });
});

describe('runCli dispatch (criterion 1/2/6)', () => {
  it('cert-path prints the generated cert path and exits 0', async () => {
    const certDir = tmpCertDir();
    await withEnv({ TLS_CERT_DIR: certDir }, async () => {
      const writes: string[] = [];
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        writes.push(String(chunk));
        return true;
      });
      try {
        const code = await runCli(['node', 'entra-local', 'cert-path']);
        expect(code).toBe(0);
        const out = writes.join('');
        expect(out).toContain('cert.pem');
        expect(existsSync(out.trim())).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('show-cert prints the path and SHA-256 fingerprint', async () => {
    const certDir = tmpCertDir();
    await withEnv({ TLS_CERT_DIR: certDir }, async () => {
      const writes: string[] = [];
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        writes.push(String(chunk));
        return true;
      });
      try {
        const code = await runCli(['node', 'entra-local', 'show-cert']);
        expect(code).toBe(0);
        const out = writes.join('');
        const path = join(certDir, 'cert.pem');
        expect(out).toContain('fingerprint:');
        expect(out).toContain(certFingerprint(readFileSync(path, 'utf8')));
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('cert-path exits 1 with a clean message when TLS is disabled', async () => {
    await withEnv({ TLS_ENABLED: 'false' }, async () => {
      const errs: string[] = [];
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        errs.push(String(chunk));
        return true;
      });
      try {
        const code = await runCli(['node', 'entra-local', 'cert-path']);
        expect(code).toBe(1);
        expect(errs.join('')).toContain('TLS is disabled');
      } finally {
        spy.mockRestore();
      }
    });
  });
});
