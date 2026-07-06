import { z } from 'zod';

/** RFC 4122 GUID (any version), case-insensitive. */
export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const NODE_ENVS = ['development', 'test', 'production'] as const;

/**
 * How the advertised per-surface origins are derived by default (when no explicit origin override
 * is set): `subdomains` advertises `login.`/`portal.`/`graph.<baseDomain>`; `compat` collapses them
 * onto the loopback `localhost` host. `npm start` / the SEA binary default to `subdomains`; the
 * Docker image sets `compat` (a container cannot make `*.entra.localhost` resolve on the host).
 */
const ORIGIN_MODES = ['subdomains', 'compat'] as const;

/** Coerce an env-string / value into a boolean, leaving invalid input to fail validation. */
function coerceBool(v: unknown): unknown {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
  }
  return v;
}

/** Coerce an env-string into a number, leaving invalid input to fail validation. */
function coerceNum(v: unknown): unknown {
  if (typeof v === 'string') {
    if (v.trim() === '') return NaN;
    return Number(v);
  }
  return v;
}

/**
 * Normalize a comma-separated string (env) or array (config file) into a trimmed string[].
 * Missing/empty input becomes an empty list so the field is always an array.
 */
function splitList(v: unknown): unknown {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    return v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return v;
}

const zBool = z.preprocess(coerceBool, z.boolean());
const zInt = (min: number, max?: number) => {
  let schema = z.number().int().min(min);
  if (max !== undefined) schema = schema.max(max);
  return z.preprocess(coerceNum, schema);
};

/**
 * Schema for the merged raw config (defaults < config file < env). Values may arrive as
 * strings (env) or native types (file/defaults); preprocessors normalize them. Any failure
 * here aborts startup with the offending key(s) named (fail-fast).
 */
export const RawConfigSchema = z
  .object({
    host: z.string().min(1),
    port: zInt(1, 65535),
    tenantId: z.string().regex(GUID_RE, 'must be a GUID'),
    issuer: z.string().url().optional(),
    publicOrigin: z.string().url().optional(),
    baseDomain: z.string().min(1),
    localDomains: z.preprocess(splitList, z.array(z.string().min(1))),
    loginOrigin: z.string().url().optional(),
    portalOrigin: z.string().url().optional(),
    graphOrigin: z.string().url().optional(),
    originMode: z.enum(ORIGIN_MODES),
    dbPath: z.string().min(1),
    tlsEnabled: zBool,
    tlsCertPath: z.string().min(1).optional(),
    tlsKeyPath: z.string().min(1).optional(),
    tlsCertDir: z.string().min(1),
    requirePassword: zBool,
    seedOnStart: zBool.optional(),
    tokenLifetimeAuthCode: zInt(1),
    tokenLifetimeId: zInt(1),
    tokenLifetimeAccess: zInt(1),
    tokenLifetimeRefresh: zInt(1),
    tokenLifetimeDeviceCode: zInt(1),
    deviceCodeInterval: zInt(1),
    graphResourceId: z.string().min(1),
    logLevel: z.enum(LOG_LEVELS),
    configFile: z.string().min(1),
    nodeEnv: z.enum(NODE_ENVS),
  })
  .superRefine((v, ctx) => {
    const hasCert = v.tlsCertPath !== undefined;
    const hasKey = v.tlsKeyPath !== undefined;
    if (hasCert !== hasKey) {
      const missing = hasCert ? 'tlsKeyPath' : 'tlsCertPath';
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [missing],
        message: 'TLS_CERT and TLS_KEY must both be set or both unset',
      });
    }
  });

export type RawConfig = z.infer<typeof RawConfigSchema>;

export type LogLevel = (typeof LOG_LEVELS)[number];
export type NodeEnv = (typeof NODE_ENVS)[number];

/** The validated, frozen configuration consumed by the whole app via `app.config`. */
export interface Config {
  readonly host: string;
  readonly port: number;
  readonly tenantId: string;
  /** `https` or `http`, derived from `tls.enabled`. */
  readonly scheme: 'https' | 'http';
  /** Token `iss` / discovery `issuer`. Derived unless overridden. */
  readonly issuer: string;
  /**
   * Base origin for endpoint URLs. Retained for back-compat; equals `origins.login` unless a
   * legacy `PUBLIC_ORIGIN` collapses every origin to a single host.
   */
  readonly publicOrigin: string;
  /** Base domain the subdomain origins are derived from (default `entra.localhost`). */
  readonly baseDomain: string;
  /** Extra apex domains included in the cert SANs and the hosts-file block. */
  readonly localDomains: readonly string[];
  /** Per-surface advertised origins, routed by `Host` header onto the one shared listener. */
  readonly origins: {
    /** STS: discovery, JWKS, authorize, token, devicecode, logout. */
    readonly login: string;
    /** Admin portal SPA + Admin REST API + `/health`. */
    readonly portal: string;
    /** Graph API + OIDC `userinfo`. */
    readonly graph: string;
  };
  readonly dbPath: string;
  readonly tls: {
    readonly enabled: boolean;
    readonly certPath?: string;
    readonly keyPath?: string;
    readonly certDir: string;
  };
  readonly requirePassword: boolean;
  readonly seedOnStart?: boolean;
  readonly tokenLifetimes: {
    readonly authCode: number;
    readonly idToken: number;
    readonly accessToken: number;
    readonly refreshToken: number;
    readonly deviceCode: number;
  };
  readonly deviceCodeInterval: number;
  readonly graphResourceId: string;
  readonly logLevel: LogLevel;
  readonly configFile: string;
  readonly nodeEnv: NodeEnv;
}

/** Assemble + freeze the public Config from a validated raw config, deriving issuer/origins. */
export function assembleConfig(raw: RawConfig): Config {
  const scheme: 'https' | 'http' = raw.tlsEnabled ? 'https' : 'http';

  // Per-surface origin precedence: explicit per-surface override > legacy PUBLIC_ORIGIN
  // collapse > `ORIGIN_MODE=compat` loopback collapse > derived `<surface>.<baseDomain>:<port>`.
  const subdomainOrigin = (sub: string): string =>
    `${scheme}://${sub}.${raw.baseDomain}:${raw.port}`;
  // `compat` (the Docker image default) collapses every surface onto the loopback host, derived
  // from PORT so a `-e PORT=…` override stays correct; explicit origins still win over it.
  const compatOrigin =
    raw.originMode === 'compat' ? `${scheme}://localhost:${raw.port}` : undefined;
  const origins = Object.freeze({
    login: raw.loginOrigin ?? raw.publicOrigin ?? compatOrigin ?? subdomainOrigin('login'),
    portal: raw.portalOrigin ?? raw.publicOrigin ?? compatOrigin ?? subdomainOrigin('portal'),
    graph: raw.graphOrigin ?? raw.publicOrigin ?? compatOrigin ?? subdomainOrigin('graph'),
  });
  const publicOrigin = origins.login;
  const issuer = raw.issuer ?? `${origins.login}/${raw.tenantId}/v2.0`;

  const config: Config = {
    host: raw.host,
    port: raw.port,
    tenantId: raw.tenantId,
    scheme,
    issuer,
    publicOrigin,
    baseDomain: raw.baseDomain,
    localDomains: Object.freeze([...raw.localDomains]),
    origins,
    dbPath: raw.dbPath,
    tls: Object.freeze({
      enabled: raw.tlsEnabled,
      ...(raw.tlsCertPath !== undefined ? { certPath: raw.tlsCertPath } : {}),
      ...(raw.tlsKeyPath !== undefined ? { keyPath: raw.tlsKeyPath } : {}),
      certDir: raw.tlsCertDir,
    }),
    requirePassword: raw.requirePassword,
    ...(raw.seedOnStart !== undefined ? { seedOnStart: raw.seedOnStart } : {}),
    tokenLifetimes: Object.freeze({
      authCode: raw.tokenLifetimeAuthCode,
      idToken: raw.tokenLifetimeId,
      accessToken: raw.tokenLifetimeAccess,
      refreshToken: raw.tokenLifetimeRefresh,
      deviceCode: raw.tokenLifetimeDeviceCode,
    }),
    deviceCodeInterval: raw.deviceCodeInterval,
    graphResourceId: raw.graphResourceId,
    logLevel: raw.logLevel,
    configFile: raw.configFile,
    nodeEnv: raw.nodeEnv,
  };

  return Object.freeze(config);
}
