/**
 * Built-in defaults (lowest precedence). These mirror the config/env reference table in
 * specs/2026-06-22_01-server-config-tls-foundation.md. Keys whose default is "derived"
 * (issuer, publicOrigin, login/portal/graph origins) or "auto" (TLS cert/key paths) are
 * intentionally absent here and resolved later. `seedOnStart` is intentionally absent (its
 * default is "true if DB empty", decided by #2).
 */
export const DEFAULTS = {
  host: 'localhost',
  port: 8443,
  tenantId: '11111111-1111-1111-1111-111111111111',
  baseDomain: 'entra.localhost',
  localDomains: [] as readonly string[],
  // How the advertised origins default: `subdomains` (npm start / SEA binary) advertises
  // login./portal./graph.<baseDomain>; `compat` (the Docker image) collapses them onto localhost.
  originMode: 'subdomains',
  dbPath: './data/entra-local.db',
  tlsEnabled: true,
  tlsCertDir: './data/tls',
  requirePassword: false,
  tokenLifetimeAuthCode: 300,
  tokenLifetimeId: 3600,
  tokenLifetimeAccess: 3600,
  tokenLifetimeRefresh: 86400,
  tokenLifetimeDeviceCode: 900,
  deviceCodeInterval: 5,
  graphResourceId: 'https://graph.microsoft.com',
  groupOverageLimit: 200,
  logLevel: 'info',
  configFile: './entra-local.config.json',
  nodeEnv: 'development',
} as const;

export const DEFAULT_TENANT_ID = DEFAULTS.tenantId;
