import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TENANT_ENDPOINTS, tenantRoute } from '../http/pathmap.js';
import { tenantGuard } from '../http/tenant.js';
import { buildDiscoveryMetadata, type DiscoveryMetadata } from './metadata.js';

/**
 * `GET /{tenant}/v2.0/.well-known/openid-configuration` — the MSAL-tuned OIDC discovery document
 * (feature #4). Replaces the reserved `501` stub for this exact path.
 *
 * All `{tenant}` aliases (`common`/`organizations`/`consumers`/GUID) resolve to the single
 * configured tenant and yield an identical, GUID-form document; an unknown tenant is rejected by
 * `tenantGuard('discovery')` with a JSON `404` (never the SPA HTML). The document is config-derived
 * and request-independent, so it is built once at registration and cached.
 */
export function registerDiscoveryRoute(app: FastifyInstance): void {
  const metadata: DiscoveryMetadata = buildDiscoveryMetadata(app.config);

  app.get(
    tenantRoute(TENANT_ENDPOINTS.discovery),
    { preHandler: tenantGuard('discovery') },
    (_request: FastifyRequest, reply: FastifyReply): void => {
      void reply
        .code(200)
        .header('cache-control', 'public, max-age=3600')
        .type('application/json')
        .send(metadata);
    },
  );
}
