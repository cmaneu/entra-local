import type { FastifyInstance } from 'fastify';
import { adminErrorHandler, adminNotFound } from './errors.js';
import { registerAppRoutes } from './routes.apps.js';
import { registerGroupRoutes } from './routes.groups.js';
import { registerSystemRoutes } from './routes.system.js';
import { registerUserRoutes } from './routes.users.js';

/**
 * Admin REST API (#11), mounted under `/admin`. An encapsulated plugin with its own error handler
 * (the canonical admin error envelope) and not-found handler (JSON, never the SPA HTML). The real
 * CRUD routes live under `/admin/api/*`; any other `/admin/*` path returns a JSON 404.
 *
 * Unauthenticated by design (locked decision: open local dev tool, documented security disclaimer).
 */
export async function registerAdminApi(app: FastifyInstance): Promise<void> {
  await app.register(
    (admin, _opts, done) => {
      admin.setErrorHandler(adminErrorHandler);
      admin.setNotFoundHandler(adminNotFound);

      registerUserRoutes(admin);
      registerGroupRoutes(admin);
      registerAppRoutes(admin);
      registerSystemRoutes(admin);

      done();
    },
    { prefix: '/admin' },
  );
}
