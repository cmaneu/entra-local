import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config/schema.js';
import { errorHandler } from './http/errors.js';
import {
  registerAdminRoutes,
  registerGraphRoutes,
  registerHealth,
  registerTenantRoutes,
} from './http/plugins.js';
import { registerSpaFallback } from './http/spaFallback.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The validated, frozen, canonical configuration (single source of truth). */
    config: Config;
  }
}

export interface BuildAppOptions {
  /** TLS material; when present the Fastify instance serves HTTPS. */
  https?: { key: string; cert: string };
}

/**
 * Build a fully-wired Fastify instance for the given config. Injectable via `app.inject(...)`
 * (used by the integration test harness) and reused by `createServer` for real listening.
 *
 * Registration order: config decorator → error handler → health → reserved tenant stubs →
 * graph plugin → admin plugin → SPA fallback (global not-found handler).
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

  registerHealth(app);
  registerTenantRoutes(app);
  await registerGraphRoutes(app);
  await registerAdminRoutes(app);
  registerSpaFallback(app);

  await app.ready();
  return app;
}
