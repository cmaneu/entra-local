import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { DEFAULTS } from './defaults.js';
import { assembleConfig, RawConfigSchema, type Config } from './schema.js';

/** Thrown when config validation fails. Carries the offending keys for fail-fast reporting. */
export class ConfigError extends Error {
  readonly issues: { key: string; message: string }[];
  constructor(issues: { key: string; message: string }[]) {
    const summary = issues.map((i) => `  - ${i.key}: ${i.message}`).join('\n');
    super(`Invalid configuration:\n${summary}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

type FlatRaw = Record<string, unknown>;

/** Keep only defined (non-undefined) entries so later sources only override real values. */
function defined(obj: FlatRaw): FlatRaw {
  const out: FlatRaw = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Map process env → flat raw config keys (only keys that are present). */
function readEnv(env: NodeJS.ProcessEnv): FlatRaw {
  return defined({
    host: env.HOST,
    port: env.PORT,
    tenantId: env.TENANT_ID,
    issuer: env.ISSUER,
    publicOrigin: env.PUBLIC_ORIGIN,
    baseDomain: env.BASE_DOMAIN,
    localDomains: env.LOCAL_DOMAINS,
    loginOrigin: env.LOGIN_ORIGIN,
    portalOrigin: env.PORTAL_ORIGIN,
    graphOrigin: env.GRAPH_ORIGIN,
    originMode: env.ORIGIN_MODE,
    dbPath: env.DB_PATH,
    tlsEnabled: env.TLS_ENABLED,
    tlsCertPath: env.TLS_CERT,
    tlsKeyPath: env.TLS_KEY,
    tlsCertDir: env.TLS_CERT_DIR,
    requirePassword: env.REQUIRE_PASSWORD,
    seedOnStart: env.SEED_ON_START,
    tokenLifetimeAuthCode: env.TOKEN_LIFETIME_AUTH_CODE_SECONDS,
    tokenLifetimeId: env.TOKEN_LIFETIME_ID_SECONDS,
    tokenLifetimeAccess: env.TOKEN_LIFETIME_ACCESS_SECONDS,
    tokenLifetimeRefresh: env.TOKEN_LIFETIME_REFRESH_SECONDS,
    tokenLifetimeDeviceCode: env.TOKEN_LIFETIME_DEVICE_CODE_SECONDS,
    deviceCodeInterval: env.DEVICE_CODE_INTERVAL_SECONDS,
    graphResourceId: env.GRAPH_RESOURCE_ID,
    groupOverageLimit: env.GROUP_OVERAGE_LIMIT,
    logLevel: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV,
  });
}

/** Shape of the optional JSON config file (all fields optional). */
const ConfigFileSchema = z
  .object({
    host: z.unknown(),
    port: z.unknown(),
    tenantId: z.unknown(),
    issuer: z.unknown(),
    publicOrigin: z.unknown(),
    baseDomain: z.unknown(),
    localDomains: z.unknown(),
    loginOrigin: z.unknown(),
    portalOrigin: z.unknown(),
    graphOrigin: z.unknown(),
    originMode: z.unknown(),
    dbPath: z.unknown(),
    tls: z
      .object({
        enabled: z.unknown(),
        certPath: z.unknown(),
        keyPath: z.unknown(),
        certDir: z.unknown(),
      })
      .partial()
      .optional(),
    requirePassword: z.unknown(),
    seedOnStart: z.unknown(),
    tokenLifetimes: z
      .object({
        authCode: z.unknown(),
        idToken: z.unknown(),
        accessToken: z.unknown(),
        refreshToken: z.unknown(),
        deviceCode: z.unknown(),
      })
      .partial()
      .optional(),
    deviceCodeInterval: z.unknown(),
    graphResourceId: z.unknown(),
    groupOverageLimit: z.unknown(),
    logLevel: z.unknown(),
  })
  .partial();

/** Map a parsed config-file object → flat raw config keys (only keys that are present). */
function readConfigFile(env: NodeJS.ProcessEnv): FlatRaw {
  const path = resolve(env.CONFIG_FILE ?? DEFAULTS.configFile);
  if (!existsSync(path)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ConfigError([
      { key: 'CONFIG_FILE', message: `failed to parse ${path}: ${(err as Error).message}` },
    ]);
  }

  const file = ConfigFileSchema.parse(parsed);
  const tls = file.tls ?? {};
  const lifetimes = file.tokenLifetimes ?? {};
  return defined({
    host: file.host,
    port: file.port,
    tenantId: file.tenantId,
    issuer: file.issuer,
    publicOrigin: file.publicOrigin,
    baseDomain: file.baseDomain,
    localDomains: file.localDomains,
    loginOrigin: file.loginOrigin,
    portalOrigin: file.portalOrigin,
    graphOrigin: file.graphOrigin,
    originMode: file.originMode,
    dbPath: file.dbPath,
    tlsEnabled: tls.enabled,
    tlsCertPath: tls.certPath,
    tlsKeyPath: tls.keyPath,
    tlsCertDir: tls.certDir,
    requirePassword: file.requirePassword,
    seedOnStart: file.seedOnStart,
    tokenLifetimeAuthCode: lifetimes.authCode,
    tokenLifetimeId: lifetimes.idToken,
    tokenLifetimeAccess: lifetimes.accessToken,
    tokenLifetimeRefresh: lifetimes.refreshToken,
    tokenLifetimeDeviceCode: lifetimes.deviceCode,
    deviceCodeInterval: file.deviceCodeInterval,
    graphResourceId: file.graphResourceId,
    groupOverageLimit: file.groupOverageLimit,
    logLevel: file.logLevel,
  });
}

/** env var name for a flat raw key, used when reporting offending keys. */
const FLAT_TO_ENV: Record<string, string> = {
  host: 'HOST',
  port: 'PORT',
  tenantId: 'TENANT_ID',
  issuer: 'ISSUER',
  publicOrigin: 'PUBLIC_ORIGIN',
  baseDomain: 'BASE_DOMAIN',
  localDomains: 'LOCAL_DOMAINS',
  loginOrigin: 'LOGIN_ORIGIN',
  portalOrigin: 'PORTAL_ORIGIN',
  graphOrigin: 'GRAPH_ORIGIN',
  originMode: 'ORIGIN_MODE',
  dbPath: 'DB_PATH',
  tlsEnabled: 'TLS_ENABLED',
  tlsCertPath: 'TLS_CERT',
  tlsKeyPath: 'TLS_KEY',
  tlsCertDir: 'TLS_CERT_DIR',
  requirePassword: 'REQUIRE_PASSWORD',
  seedOnStart: 'SEED_ON_START',
  tokenLifetimeAuthCode: 'TOKEN_LIFETIME_AUTH_CODE_SECONDS',
  tokenLifetimeId: 'TOKEN_LIFETIME_ID_SECONDS',
  tokenLifetimeAccess: 'TOKEN_LIFETIME_ACCESS_SECONDS',
  tokenLifetimeRefresh: 'TOKEN_LIFETIME_REFRESH_SECONDS',
  tokenLifetimeDeviceCode: 'TOKEN_LIFETIME_DEVICE_CODE_SECONDS',
  deviceCodeInterval: 'DEVICE_CODE_INTERVAL_SECONDS',
  graphResourceId: 'GRAPH_RESOURCE_ID',
  groupOverageLimit: 'GROUP_OVERAGE_LIMIT',
  logLevel: 'LOG_LEVEL',
  configFile: 'CONFIG_FILE',
  nodeEnv: 'NODE_ENV',
};

/**
 * Load + validate configuration. Precedence (highest first): env > config file > defaults.
 * Throws {@link ConfigError} (naming offending keys) on any validation failure — callers
 * should treat this as fail-fast (non-zero exit, no partial boot).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const merged: FlatRaw = {
    ...DEFAULTS,
    ...readConfigFile(env),
    ...readEnv(env),
    configFile: resolve(env.CONFIG_FILE ?? DEFAULTS.configFile),
    nodeEnv: env.NODE_ENV ?? DEFAULTS.nodeEnv,
  };

  const result = RawConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const flatKey = String(issue.path[0] ?? '(root)');
      const key = FLAT_TO_ENV[flatKey] ?? flatKey;
      return { key, message: issue.message };
    });
    throw new ConfigError(issues);
  }

  return assembleConfig(result.data);
}
