import type { FastifyInstance } from 'fastify';
import { registerAuthorizeRoutes } from './authorize.js';
import { registerLogoutRoute } from './logout.js';
import { registerTokenRoute } from './token.js';

/**
 * Register the feature #6 OAuth flow routes — `/authorize` (GET+POST) and `/token` (POST) — plus
 * the feature #9 `/logout` (GET) end-session route, all replacing their reserved `501` stubs. Must
 * run after the store, token service, and the cookie/formbody plugins are wired (see `buildApp`).
 * #7/#8/#15 extend the `/token` dispatch.
 */
export function registerOAuthRoutes(app: FastifyInstance): void {
  registerAuthorizeRoutes(app);
  registerTokenRoute(app);
  registerLogoutRoute(app);
}
