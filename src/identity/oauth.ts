import type { FastifyInstance } from 'fastify';
import { registerAuthorizeRoutes } from './authorize.js';
import { registerDeviceCodeRoutes } from './deviceCode.js';
import { registerLogoutRoute } from './logout.js';
import { registerTokenRoute } from './token.js';

/**
 * Register the feature #6 OAuth flow routes — `/authorize` (GET+POST) and `/token` (POST) — plus
 * the feature #9 `/logout` (GET) end-session route and the #15 device-code routes (`/devicecode`
 * GET+POST + `/devicecode/verify` POST), all replacing their reserved `501` stubs. Must run after
 * the store, token service, and the cookie/formbody plugins are wired (see `buildApp`).
 */
export function registerOAuthRoutes(app: FastifyInstance): void {
  registerAuthorizeRoutes(app);
  registerTokenRoute(app);
  registerLogoutRoute(app);
  registerDeviceCodeRoutes(app);
}
