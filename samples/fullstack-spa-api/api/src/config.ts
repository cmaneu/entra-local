import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Sample API configuration, resolved from environment variables with developer-friendly defaults
 * that match the Entra Local emulator's seeded full-stack sample apps (feature #24).
 *
 * Every value can be overridden with an environment variable so the sample works against a
 * non-default emulator (different host/port, tenant, or app registration) without code changes.
 */
export interface ApiConfig {
  /** Port the Express API listens on. */
  port: number;
  /** Emulator origin (scheme + host + port), e.g. `https://localhost:8443`. */
  origin: string;
  /** Tenant GUID used to build the issuer and JWKS URLs. */
  tenantId: string;
  /** The API app registration GUID. Incoming tokens must carry this as their `aud`. */
  apiAppId: string;
  /** The delegated scope the caller must hold (`scp` must contain this value). */
  requiredScope: string;
  /** SPA origin allowed by CORS. */
  spaOrigin: string;
  /**
   * Filesystem path to the emulator's self-signed dev certificate (PEM). The API trusts this CA
   * explicitly for the HTTPS JWKS fetch, so the sample works without setting `NODE_EXTRA_CA_CERTS`
   * before starting Node. Defaults to the emulator's `data/tls/cert.pem` at the repo root.
   */
  caCertPath: string;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer (got "${raw}").`);
  }
  return parsed;
}

/**
 * Resolve the path to the emulator's dev certificate.
 *
 * Precedence: `EMULATOR_CA_CERT` → `NODE_EXTRA_CA_CERTS` (so existing setups keep working) → the
 * emulator's default `data/tls/cert.pem` at the repo root. Relative overrides resolve against the
 * current working directory; the default resolves against this source file so it is independent of
 * where `npm start` is run from.
 */
function resolveCaCertPath(): string {
  const override = process.env.EMULATOR_CA_CERT ?? process.env.NODE_EXTRA_CA_CERTS;
  if (override != null && override.trim() !== '') {
    return resolve(override.trim());
  }
  // This file lives at samples/fullstack-spa-api/api/src/config.ts; the repo root is four levels up.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../../data/tls/cert.pem');
}

export function loadConfig(): ApiConfig {
  return {
    port: envInt('PORT', 4000),
    origin: process.env.EMULATOR_ORIGIN ?? 'https://localhost:8443',
    tenantId: process.env.TENANT_ID ?? '11111111-1111-1111-1111-111111111111',
    apiAppId: process.env.API_APP_ID ?? 'cccccccc-0000-0000-0000-000000000005',
    requiredScope: process.env.REQUIRED_SCOPE ?? 'access_as_user',
    spaOrigin: process.env.SPA_ORIGIN ?? 'http://localhost:5173',
    caCertPath: resolveCaCertPath(),
  };
}

/** Concrete-GUID issuer advertised by the emulator's discovery document (`<origin>/<tenant>/v2.0`). */
export function issuer(config: ApiConfig): string {
  return `${config.origin}/${config.tenantId}/v2.0`;
}

/** The emulator's JWKS endpoint (`<origin>/<tenant>/discovery/v2.0/keys`). */
export function jwksUri(config: ApiConfig): string {
  return `${config.origin}/${config.tenantId}/discovery/v2.0/keys`;
}
