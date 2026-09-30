import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { toPaged } from './dto.js';
import { invalidReference, notFound, validationError } from './errors.js';
import { listQuerySchema, roleAssignmentSchema } from './schemas.js';

interface AppParams {
  id: string;
}
interface AssignmentParams extends AppParams {
  roleId: string;
  userId: string;
}

export function registerRoleAssignmentRoutes(app: FastifyInstance): void {
  const { store } = app;
  const requireApp = (id: string) => {
    const registration = store.apps.getByAppId(id);
    if (!registration) throw notFound(`No app with id '${id}'.`);
    return registration;
  };

  app.get('/api/apps/:id/roleAssignments', (request: FastifyRequest<{ Params: AppParams }>) => {
    const registration = requireApp(request.params.id);
    const { top, skip } = listQuerySchema.parse(request.query);
    return toPaged(
      store.roleAssignments.list(registration.appId, top, skip),
      store.roleAssignments.count(registration.appId),
      top,
      skip,
    );
  });

  app.post(
    '/api/apps/:id/roleAssignments',
    (request: FastifyRequest<{ Params: AppParams }>, reply: FastifyReply) => {
      const registration = requireApp(request.params.id);
      const { roleId, userId } = roleAssignmentSchema.parse(request.body);
      const role = store.apps.listRoles(registration.appId).find((role) => role.id === roleId);
      if (!role) throw invalidReference('Role does not belong to this app.', 'roleId');
      const user = store.users.getById(userId);
      if (!user || user.tenantId !== registration.tenantId) {
        throw invalidReference("User does not exist in this app's tenant.", 'userId');
      }
      if (!store.roleAssignments.has(roleId, userId)) {
        if (!role.isEnabled || !role.allowedMemberTypes.split(',').includes('User')) {
          throw validationError(
            'Role must be enabled and allow User assignments.',
            undefined,
            'roleId',
          );
        }
        store.roleAssignments.add(roleId, userId);
      }
      void reply.code(204);
      return null;
    },
  );

  app.delete(
    '/api/apps/:id/roleAssignments/:roleId/:userId',
    (request: FastifyRequest<{ Params: AssignmentParams }>, reply: FastifyReply) => {
      const registration = requireApp(request.params.id);
      store.roleAssignments.remove(
        registration.appId,
        request.params.roleId,
        request.params.userId,
      );
      void reply.code(204);
      return null;
    },
  );
}
