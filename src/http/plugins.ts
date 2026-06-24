import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createGraphHandlers } from '../graph/handlers.js';
import { createUserInfoHandler } from '../identity/userinfo.js';
import { appVersion } from '../version.js';
import { sendJsonNotFound } from './errors.js';

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
