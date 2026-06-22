import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/loadConfig.js';
import { DEFAULTS } from '../../src/config/defaults.js';
import { TMP_DIR } from '../helpers/constants.js';

/** Base env that resolves to all defaults (config file pointed at a nonexistent path). */
function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    CONFIG_FILE: join(TMP_DIR, `${randomUUID()}.does-not-exist.json`),
    ...overrides,
  };
}

const createdFiles: string[] = [];

afterEach(() => {
  for (const f of createdFiles.splice(0)) rmSync(f, { force: true });
});

function writeConfigFile(content: unknown): string {
  mkdirSync(TMP_DIR, { recursive: true });
  const path = join(TMP_DIR, `${randomUUID()}.config.json`);
  writeFileSync(path, JSON.stringify(content), 'utf8');
  createdFiles.push(path);
  return path;
}

describe('loadConfig — defaults & shape (criterion 2)', () => {
  it('produces a frozen Config matching the reference-table defaults', () => {
    const config = loadConfig(baseEnv());

    expect(config.host).toBe(DEFAULTS.host);
    expect(config.port).toBe(DEFAULTS.port);
    expect(config.tenantId).toBe(DEFAULTS.tenantId);
    expect(config.dbPath).toBe(DEFAULTS.dbPath);
    expect(config.tls.enabled).toBe(true);
    expect(config.tls.certDir).toBe(DEFAULTS.tlsCertDir);
    expect(config.requirePassword).toBe(false);
    expect(config.tokenLifetimes).toEqual({
      authCode: 300,
      idToken: 3600,
      accessToken: 3600,
      refreshToken: 86400,
      deviceCode: 900,
    });
    expect(config.graphResourceId).toBe('https://graph.microsoft.com');
    expect(config.logLevel).toBe('info');

    // Derived values.
    expect(config.scheme).toBe('https');
    expect(config.publicOrigin).toBe('https://localhost:8443');
    expect(config.issuer).toBe(`https://localhost:8443/${DEFAULTS.tenantId}/v2.0`);

    // Frozen (single canonical source).
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.tls)).toBe(true);
    expect(Object.isFrozen(config.tokenLifetimes)).toBe(true);
  });

  it('derives http scheme + origin when TLS disabled', () => {
    const config = loadConfig(baseEnv({ TLS_ENABLED: 'false' }));
    expect(config.scheme).toBe('http');
    expect(config.publicOrigin).toBe('http://localhost:8443');
    expect(config.issuer).toBe(`http://localhost:8443/${DEFAULTS.tenantId}/v2.0`);
  });
});

describe('loadConfig — validation failures name the offending key (criterion 2)', () => {
  it('rejects a non-GUID TENANT_ID', () => {
    try {
      loadConfig(baseEnv({ TENANT_ID: 'not-a-guid' }));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).issues.map((i) => i.key)).toContain('TENANT_ID');
    }
  });

  it('rejects PORT=0', () => {
    try {
      loadConfig(baseEnv({ PORT: '0' }));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ConfigError).issues.map((i) => i.key)).toContain('PORT');
    }
  });

  it('rejects only TLS_CERT set (both-or-neither)', () => {
    try {
      loadConfig(baseEnv({ TLS_CERT: './cert.pem' }));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ConfigError).issues.map((i) => i.key)).toContain('TLS_KEY');
    }
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig(baseEnv({ PORT: 'abc' }))).toThrow(ConfigError);
  });

  it('rejects an invalid LOG_LEVEL', () => {
    expect(() => loadConfig(baseEnv({ LOG_LEVEL: 'verbose' }))).toThrow(ConfigError);
  });
});

describe('loadConfig — precedence env > file > defaults (criterion 3)', () => {
  it('config file overrides defaults', () => {
    const file = writeConfigFile({ port: 9000, logLevel: 'debug' });
    const config = loadConfig(baseEnv({ CONFIG_FILE: file }));
    expect(config.port).toBe(9000);
    expect(config.logLevel).toBe('debug');
  });

  it('env overrides config file', () => {
    const file = writeConfigFile({ port: 9000 });
    const config = loadConfig(baseEnv({ CONFIG_FILE: file, PORT: '7000' }));
    expect(config.port).toBe(7000);
  });

  it('absent config file is not an error', () => {
    expect(() => loadConfig(baseEnv())).not.toThrow();
  });

  it('reads nested tls + tokenLifetimes from the config file', () => {
    const file = writeConfigFile({
      tls: { enabled: false, certDir: './custom/tls' },
      tokenLifetimes: { accessToken: 1200 },
    });
    const config = loadConfig(baseEnv({ CONFIG_FILE: file }));
    expect(config.tls.enabled).toBe(false);
    expect(config.tls.certDir).toBe('./custom/tls');
    expect(config.tokenLifetimes.accessToken).toBe(1200);
  });
});
