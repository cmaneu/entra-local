import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { appVersion } from '../version.js';
import { sendJsonNotFound, sendNotImplemented } from './errors.js';
import { tenantGuard } from './tenant.js';

/** Documented `/health` response shape (see spec). Never requires auth. */
export interface HealthResponse {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
  tls: boolean;
  tenantId: string;
}

/** `GET /health` — liveness/readiness JSON (Docker healthcheck + e2e readiness poll). */
export function registerHealth(app: FastifyInstance): void {
  app.get('/health', (_request: FastifyRequest, reply: FastifyReply): void => {
    const body: HealthResponse = {
      status: 'ok',
      version: appVersion(),
      uptimeSeconds: Math.floor(process.uptime()),
      tls: app.config.tls.enabled,
      tenantId: app.config.tenantId,
    };
    void reply.code(200).send(body);
  });
}

/**
 * Reserved `/{tenant}/...` OIDC/OAuth routes. Registered as parametric (`:tenant`) routes so an
 * unknown tenant resolves to a JSON error (via tenantGuard), and a valid tenant resolves to a
 * `501` stub until the owning feature replaces it (Reserved-stub rule).
 */
export function registerTenantRoutes(app: FastifyInstance): void {
  const oauthGuard = { preHandler: tenantGuard('oauth') };
  const discoveryGuard = { preHandler: tenantGuard('discovery') };

  // OIDC discovery (#4) + JWKS (#3).
  app.get(
    '/:tenant/v2.0/.well-known/openid-configuration',
    discoveryGuard,
    sendNotImplemented('#4'),
  );
  app.get('/:tenant/discovery/v2.0/keys', discoveryGuard, sendNotImplemented('#3'));

  // OAuth endpoints (#6 / #9 / #15).
  app.get('/:tenant/oauth2/v2.0/authorize', oauthGuard, sendNotImplemented('#6'));
  app.post('/:tenant/oauth2/v2.0/authorize', oauthGuard, sendNotImplemented('#6'));
  app.post('/:tenant/oauth2/v2.0/token', oauthGuard, sendNotImplemented('#6'));
  app.get('/:tenant/oauth2/v2.0/logout', oauthGuard, sendNotImplemented('#9'));
  app.post('/:tenant/oauth2/v2.0/devicecode', oauthGuard, sendNotImplemented('#15'));
}

/**
 * Minimal Microsoft Graph surface (#9 / #10), mounted under `/graph`. Reserved paths are `501`
 * stubs; any other `/graph/*` route returns a JSON 404 (never the SPA).
 */
export async function registerGraphRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    (graph, _opts, done) => {
      graph.setNotFoundHandler(sendJsonNotFound);

      graph.get('/v1.0/me', sendNotImplemented('#10'));
      graph.get('/v1.0/users', sendNotImplemented('#10'));
      graph.get('/v1.0/users/:id', sendNotImplemented('#10'));
      graph.get('/v1.0/groups', sendNotImplemented('#10'));
      graph.get('/v1.0/groups/:id', sendNotImplemented('#10'));
      graph.get('/v1.0/groups/:id/members', sendNotImplemented('#10'));

      // OIDC UserInfo (#9). Locked single-origin path (overrides draft global-spec).
      graph.get('/oidc/userinfo', sendNotImplemented('#9'));
      graph.post('/oidc/userinfo', sendNotImplemented('#9'));

      done();
    },
    { prefix: '/graph' },
  );
}

/**
 * Admin REST API surface (#11), mounted under `/admin`. No `501` stubs (not part of the
 * reserved OIDC/OAuth/Graph stub set); unmatched `/admin/*` routes return a JSON 404.
 */
export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    (admin, _opts, done) => {
      admin.setNotFoundHandler(sendJsonNotFound);
      done();
    },
    { prefix: '/admin' },
  );
}
