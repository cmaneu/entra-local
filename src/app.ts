import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config/schema.js';
import { errorHandler } from './http/errors.js';
import { registerGraphRoutes, registerHealth, registerTenantRoutes } from './http/plugins.js';
import { registerSpaFallback } from './http/spaFallback.js';
import { registerAdminApi } from './admin/plugin.js';
import { registerDiscoveryRoute } from './identity/discovery.js';
import { registerOAuthRoutes } from './identity/oauth.js';
import type { NewSigningKey } from './store/types.js';
import { registerStore } from './store/plugin.js';
import { registerTokens } from './tokens/jwks.js';
import { registerTokenService } from './tokens/service.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The validated, frozen, canonical configuration (single source of truth). */
    config: Config;
  }
}

export interface BuildAppOptions {
  /** TLS material; when present the Fastify instance serves HTTPS. */
  https?: { key: string; cert: string };
  /**
   * Pre-seed a fixed signing key before the ensure-active-key bootstrap runs. When set, the
   * bootstrap reuses it instead of generating a random key — used by the test harness for
   * byte-reproducible JWKS/token output. Unused in production.
   */
  signingKey?: NewSigningKey;
}

/**
 * Build a fully-wired Fastify instance for the given config. Injectable via `app.inject(...)`
 * (used by the integration test harness) and reused by `createServer` for real listening.
 *
 * Registration order: config decorator → error handler → body/cookie/CORS plugins → store (DB +
 * migrations + seed) → tokens (signing-key bootstrap + JWKS) → token service (#5) → health →
 * reserved tenant stubs → discovery (#4) → OAuth flow (#6 authorize/token) → graph plugin → admin
 * plugin → SPA fallback (global not-found handler).
 */
export async function buildApp(
  config: Config,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const serverOptions: FastifyServerOptions = {
    logger: { level: config.logLevel },
    disableRequestLogging: config.logLevel === 'silent',
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'reqId',
  };
  if (options.https) {
    (serverOptions as Record<string, unknown>).https = options.https;
  }

  const app = Fastify(serverOptions);

  app.decorate('config', config);
  app.setErrorHandler(errorHandler);

  // Body/cookie/CORS plugins required by the OAuth flow (#6): form-encoded `/authorize` + `/token`
  // bodies, the SSO session cookie, and permissive CORS so a real browser-based MSAL SPA can call
  // the token/discovery/JWKS endpoints cross-origin (reflects the request Origin; dev-tool scope).
  await app.register(formbody);
  await app.register(cookie);
  await app.register(cors, { origin: true, credentials: true, maxAge: 3600 });

  registerStore(app);

  // Optional deterministic key seed (test harness): insert before the bootstrap so it is reused.
  // Requires the tenant FK row; skip on an unseeded DB (the bootstrap is likewise deferred).
  if (options.signingKey && app.store.tenants.get(config.tenantId) !== undefined) {
    app.store.signingKeys.insert(options.signingKey);
  }
  await registerTokens(app);
  registerTokenService(app);

  registerHealth(app);
  registerTenantRoutes(app);
  registerDiscoveryRoute(app);
  registerOAuthRoutes(app);
  await registerGraphRoutes(app);
  await registerAdminApi(app);
  registerSpaFallback(app);

  await app.ready();
  return app;
}
