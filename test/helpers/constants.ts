import { fileURLToPath } from 'node:url';
import type { Config } from '../../src/config/schema.js';

/** Deterministic tenant GUID used across all tests (matches the spec default). */
export const TEST_TENANT_ID = '11111111-1111-1111-1111-111111111111';

/** Fixed host/port for harness config (PORT is unused by `inject`-based tests). */
export const TEST_HOST = 'localhost';
export const TEST_PORT = 8443;

/** Directory for ephemeral per-test SQLite files. NOT the OS temp dir (repo policy). */
export const TMP_DIR = fileURLToPath(new URL('../../data/.tmp/', import.meta.url));

/**
 * Deterministic base config for in-process (`inject`) tests: HTTPS disabled (irrelevant to
 * inject), silent logging, fixed tenant. `dbPath` is supplied per-call by buildTestApp.
 */
export function makeTestConfig(dbPath: string): Config {
  const scheme = 'http';
  const publicOrigin = `${scheme}://${TEST_HOST}:${TEST_PORT}`;
  return Object.freeze({
    host: TEST_HOST,
    port: TEST_PORT,
    tenantId: TEST_TENANT_ID,
    scheme,
    issuer: `${publicOrigin}/${TEST_TENANT_ID}/v2.0`,
    publicOrigin,
    baseDomain: 'entra.localhost',
    localDomains: Object.freeze([]),
    // Collapsed single-origin: every surface served on the compat host so `inject` (which
    // defaults the Host header to localhost) and the existing assertions stay origin-stable.
    origins: Object.freeze({ login: publicOrigin, portal: publicOrigin, graph: publicOrigin }),
    dbPath,
    tls: Object.freeze({ enabled: false, certDir: './data/tls' }),
    requirePassword: false,
    tokenLifetimes: Object.freeze({
      authCode: 300,
      idToken: 3600,
      accessToken: 3600,
      refreshToken: 86400,
      deviceCode: 900,
    }),
    deviceCodeInterval: 5,
    graphResourceId: 'https://graph.microsoft.com',
    logLevel: 'silent',
    configFile: './entra-local.config.json',
    nodeEnv: 'test',
  }) satisfies Config;
}
