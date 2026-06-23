import type { FastifyInstance, FastifyRequest } from 'fastify';
import { appVersion } from '../version.js';
import { resetSchema, seedSchema } from './schemas.js';

/** Register `/admin/api/{seed,reset,health}` routes on the admin (sub-)instance. */
export function registerSystemRoutes(app: FastifyInstance): void {
  const { store, config } = app;

  app.post('/api/seed', (request: FastifyRequest) => {
    const { force } = seedSchema.parse(request.body ?? {});
    const hasTenant = store.tenants.getDefault() !== undefined;
    if (!force && hasTenant) {
      return { seeded: false };
    }
    store.seed(); // idempotent skip-existing (INSERT OR IGNORE); never deletes
    return { seeded: true };
  });

  app.post('/api/reset', (request: FastifyRequest) => {
    const { reseed, resetKeys } = resetSchema.parse(request.body ?? {});
    store.reset({ reseed, resetKeys });
    return { reset: true, reseeded: reseed };
  });

  app.get('/api/health', () => {
    return {
      status: 'ok' as const,
      version: appVersion(),
      uptimeSeconds: Math.floor(process.uptime()),
      tls: config.tls.enabled,
      tenantId: config.tenantId,
    };
  });
}
