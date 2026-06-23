import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createGraphHandlers } from '../graph/handlers.js';
import { createUserInfoHandler } from '../identity/userinfo.js';
import { appVersion } from '../version.js';
import { sendJsonNotFound, sendNotImplemented } from './errors.js';
import { TENANT_ENDPOINTS, tenantRoute } from './pathmap.js';
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

  // OIDC discovery (#4) is registered by `registerDiscoveryRoute` (real handler, not a stub).
  // JWKS (#3) is registered by `registerTokens` (real handler, not a stub).

  // OAuth endpoints (#6 / #9 / #15).
  // /authorize (GET+POST) and /token (POST) are real handlers registered by `registerOAuthRoutes`
  // (feature #6); /logout (GET) is the real #9 end-session handler (also via `registerOAuthRoutes`).
  // The remaining endpoint is still a reserved stub.
  app.post(tenantRoute(TENANT_ENDPOINTS.devicecode), oauthGuard, sendNotImplemented('#15'));
}

/**
 * Minimal Microsoft Graph surface (#9 / #10), mounted under `/graph`. The `/v1.0/*` read endpoints
 * (#10) are real handlers; any other `/graph/*` route returns a JSON 404 (never the SPA).
 */
export async function registerGraphRoutes(app: FastifyInstance): Promise<void> {
  const userInfo = createUserInfoHandler({
    store: app.store,
    tokenService: app.tokenService,
    config: app.config,
  });
  const graphApi = createGraphHandlers({
    store: app.store,
    tokenService: app.tokenService,
    config: app.config,
  });

  await app.register(
    (graph, _opts, done) => {
      graph.setNotFoundHandler(sendJsonNotFound);

      // Minimal Microsoft Graph (#10): read-only `/me`, `/users`, `/groups`.
      graph.get('/v1.0/me', graphApi.me);
      graph.get('/v1.0/users', graphApi.listUsers);
      graph.get('/v1.0/users/:id', graphApi.getUser);
      graph.get('/v1.0/groups', graphApi.listGroups);
      graph.get('/v1.0/groups/:id', graphApi.getGroup);
      graph.get('/v1.0/groups/:id/members', graphApi.listGroupMembers);

      // OIDC UserInfo (#9). Locked single-origin path (overrides draft global-spec). POST mirrors
      // GET for OIDC parity.
      graph.get('/oidc/userinfo', userInfo);
      graph.post('/oidc/userinfo', userInfo);

      done();
    },
    { prefix: '/graph' },
  );
}
