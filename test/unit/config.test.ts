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
    expect(config.baseDomain).toBe('entra.localhost');
    expect(config.localDomains).toEqual([]);
    expect(config.origins).toEqual({
      login: 'https://login.entra.localhost:8443',
      portal: 'https://portal.entra.localhost:8443',
      graph: 'https://graph.entra.localhost:8443',
    });
    expect(config.publicOrigin).toBe('https://login.entra.localhost:8443');
    expect(config.issuer).toBe(`https://login.entra.localhost:8443/${DEFAULTS.tenantId}/v2.0`);

    // Frozen (single canonical source).
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.tls)).toBe(true);
    expect(Object.isFrozen(config.tokenLifetimes)).toBe(true);
  });

  it('derives http scheme + origins when TLS disabled', () => {
    const config = loadConfig(baseEnv({ TLS_ENABLED: 'false' }));
    expect(config.scheme).toBe('http');
    expect(config.origins.login).toBe('http://login.entra.localhost:8443');
    expect(config.publicOrigin).toBe('http://login.entra.localhost:8443');
    expect(config.issuer).toBe(`http://login.entra.localhost:8443/${DEFAULTS.tenantId}/v2.0`);
  });

  it('derives subdomain origins from BASE_DOMAIN + PORT', () => {
    const config = loadConfig(baseEnv({ BASE_DOMAIN: 'entra.test', PORT: '9443' }));
    expect(config.origins).toEqual({
      login: 'https://login.entra.test:9443',
      portal: 'https://portal.entra.test:9443',
      graph: 'https://graph.entra.test:9443',
    });
    expect(config.issuer).toBe(`https://login.entra.test:9443/${DEFAULTS.tenantId}/v2.0`);
  });

  it('collapses every origin to PUBLIC_ORIGIN (legacy single-origin back-compat)', () => {
    const config = loadConfig(baseEnv({ PUBLIC_ORIGIN: 'https://localhost:8443' }));
    expect(config.origins).toEqual({
      login: 'https://localhost:8443',
      portal: 'https://localhost:8443',
      graph: 'https://localhost:8443',
    });
    expect(config.publicOrigin).toBe('https://localhost:8443');
    expect(config.issuer).toBe(`https://localhost:8443/${DEFAULTS.tenantId}/v2.0`);
  });

  it('lets a per-surface origin override win over PUBLIC_ORIGIN', () => {
    const config = loadConfig(
      baseEnv({
        PUBLIC_ORIGIN: 'https://localhost:8443',
        GRAPH_ORIGIN: 'https://graph.entra.localhost:8443',
      }),
    );
    expect(config.origins.login).toBe('https://localhost:8443');
    expect(config.origins.portal).toBe('https://localhost:8443');
    expect(config.origins.graph).toBe('https://graph.entra.localhost:8443');
  });

  it('collapses every origin onto localhost with ORIGIN_MODE=compat (Docker default)', () => {
    const config = loadConfig(baseEnv({ ORIGIN_MODE: 'compat' }));
    expect(config.origins).toEqual({
      login: 'https://localhost:8443',
      portal: 'https://localhost:8443',
      graph: 'https://localhost:8443',
    });
    expect(config.publicOrigin).toBe('https://localhost:8443');
    expect(config.issuer).toBe(`https://localhost:8443/${DEFAULTS.tenantId}/v2.0`);
  });

  it('derives the compat origin port from PORT (not hardcoded)', () => {
    const config = loadConfig(baseEnv({ ORIGIN_MODE: 'compat', PORT: '9000' }));
    expect(config.origins.login).toBe('https://localhost:9000');
    expect(config.issuer).toBe(`https://localhost:9000/${DEFAULTS.tenantId}/v2.0`);
  });

  it('uses the http scheme for the compat origin when TLS is disabled', () => {
    const config = loadConfig(baseEnv({ ORIGIN_MODE: 'compat', TLS_ENABLED: 'false' }));
    expect(config.origins.login).toBe('http://localhost:8443');
  });

  it('lets PUBLIC_ORIGIN and per-surface overrides win over ORIGIN_MODE=compat', () => {
    const withPublic = loadConfig(
      baseEnv({ ORIGIN_MODE: 'compat', PUBLIC_ORIGIN: 'https://entra.localtest.me:8443' }),
    );
    expect(withPublic.origins.login).toBe('https://entra.localtest.me:8443');

    const withSurface = loadConfig(
      baseEnv({ ORIGIN_MODE: 'compat', GRAPH_ORIGIN: 'https://graph.entra.localhost:8443' }),
    );
    expect(withSurface.origins.login).toBe('https://localhost:8443');
    expect(withSurface.origins.graph).toBe('https://graph.entra.localhost:8443');
  });

  it('rejects an unknown ORIGIN_MODE value', () => {
    expect(() => loadConfig(baseEnv({ ORIGIN_MODE: 'bogus' }))).toThrow(ConfigError);
  });

  it('parses LOCAL_DOMAINS as a comma-separated list', () => {
    const config = loadConfig(baseEnv({ LOCAL_DOMAINS: 'entra.example, foo.localhost ,' }));
    expect(config.localDomains).toEqual(['entra.example', 'foo.localhost']);
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
