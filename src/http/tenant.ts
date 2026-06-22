import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { TENANT_ALIASES } from './pathmap.js';

/** Build the allowlist of accepted `{tenant}` segment values for the configured tenant. */
export function tenantAllowlist(tenantId: string): string[] {
  return [tenantId, ...TENANT_ALIASES];
}

/** Whether a `{tenant}` path segment is allowed for the configured tenant. */
export function isAllowedTenant(tenant: string, tenantId: string): boolean {
  return tenantAllowlist(tenantId).includes(tenant);
}

type TenantParams = { tenant?: string };

/**
 * preHandler that rejects a non-allowlisted `{tenant}` segment with a JSON error (never the
 * SPA). For OAuth endpoints the error style is `invalid_request` (400); for discovery/JWKS it
 * is a `404`. The tenant-alias *normalization* rules are owned by #4 — this only enforces the
 * allowlist so that, pre-#4, an invalid tenant yields a JSON error rather than SPA HTML.
 */
export function tenantGuard(style: 'oauth' | 'discovery'): preHandlerHookHandler {
  return function guard(
    request: FastifyRequest,
    reply: FastifyReply,
    done: (err?: Error) => void,
  ): void {
    const tenant = (request.params as TenantParams).tenant ?? '';
    const tenantId = request.server.config.tenantId;
    if (isAllowedTenant(tenant, tenantId)) {
      done();
      return;
    }

    if (style === 'oauth') {
      void reply.code(400).send({
        error: 'invalid_request',
        error_description: `Unknown tenant '${tenant}'.`,
      });
    } else {
      void reply.code(404).send({
        error: { code: 'tenant_not_found', message: `Unknown tenant '${tenant}'.` },
      });
    }
  };
}
