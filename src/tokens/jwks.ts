import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TENANT_ENDPOINTS, tenantRoute } from '../http/pathmap.js';
import { tenantGuard } from '../http/tenant.js';
import { createSigningService, type SigningService } from './keys.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Signing-key accessors (RSA/RS256). Owned by feature #3. #5 (token service) calls
     * `app.signing.getActiveSigner(tenantId)` to mint tokens; #5/#10 call `getVerificationKey(kid)`.
     */
    signing: SigningService;
  }
}

/**
 * Wire feature #3 into the app: decorate `app.signing`, run the ensure-active-key bootstrap (so a
 * fresh DB gets exactly one persisted active key before any request), and register the real JWKS
 * endpoint (replacing the reserved `501` stub). Must run after the store is live (`registerStore`).
 */
export async function registerTokens(app: FastifyInstance): Promise<void> {
  const signing = createSigningService(app.store);
  app.decorate('signing', signing);

  // The signing-key bootstrap needs the tenant FK row to exist. With an unseeded DB
  // (SEED_ON_START=false on an empty file) there is no tenant yet, so defer key generation
  // until a tenant exists (e.g. created via admin in #11). The JWKS endpoint still works,
  // returning an empty key set until then.
  if (app.store.tenants.get(app.config.tenantId) !== undefined) {
    await signing.ensureActiveKey(app.config.tenantId);
  }

  registerJwksRoute(app);
}

/**
 * `GET /{tenant}/discovery/v2.0/keys` — the JWK Set. All `{tenant}` aliases resolve to the single
 * configured tenant's key set. Returns only public components with a long cache lifetime (keys are
 * stable across restarts). Replaces the reserved-stub `501` for this exact path.
 */
function registerJwksRoute(app: FastifyInstance): void {
  app.get(
    tenantRoute(TENANT_ENDPOINTS.jwks),
    { preHandler: tenantGuard('discovery') },
    (_request: FastifyRequest, reply: FastifyReply): void => {
      // Aliases (common/organizations/consumers/GUID) all map to the one configured tenant.
      const jwks = app.signing.listJwks(app.config.tenantId);
      void reply
        .code(200)
        .header('cache-control', 'public, max-age=86400')
        .type('application/json')
        .send(jwks);
    },
  );
}
