import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { NewGroup } from '../store/types.js';
import { toGroupDto, toPaged, toUserDto } from './dto.js';
import { invalidReference, notFound } from './errors.js';
import {
  groupCreateSchema,
  groupPatchSchema,
  listQuerySchema,
  memberAddSchema,
} from './schemas.js';

interface IdParams {
  id: string;
}
interface MemberParams {
  id: string;
  userId: string;
}

/** Register `/admin/api/groups` routes (incl. membership) on the admin (sub-)instance. */
export function registerGroupRoutes(app: FastifyInstance): void {
  const { store } = app;
  const tenantId = app.config.tenantId;

  app.get('/api/groups', (request: FastifyRequest) => {
    const query = listQuerySchema.parse(request.query);
    const value = store.groups
      .list({ top: query.top, skip: query.skip, search: query.search })
      .map((g) => toGroupDto(g, store.groups.memberCount(g.id)));
    const count = store.groups.count({ search: query.search });
    return toPaged(value, count, query.top, query.skip);
  });

  app.post('/api/groups', (request: FastifyRequest, reply: FastifyReply) => {
    const body = groupCreateSchema.parse(request.body);
    const input: NewGroup = {
      tenantId,
      displayName: body.displayName,
      description: body.description ?? null,
    };
    const created = store.groups.create(input);
    void reply.code(201);
    return toGroupDto(created, 0);
  });

  app.get('/api/groups/:id', (request: FastifyRequest<{ Params: IdParams }>) => {
    const group = store.groups.getById(request.params.id);
    if (!group) throw notFound(`No group with id '${request.params.id}'.`);
    return toGroupDto(group, store.groups.memberCount(group.id));
  });

  app.patch('/api/groups/:id', (request: FastifyRequest<{ Params: IdParams }>) => {
    const id = request.params.id;
    if (!store.groups.getById(id)) throw notFound(`No group with id '${id}'.`);
    const body = groupPatchSchema.parse(request.body);
    const updated = store.groups.update(id, body);
    return toGroupDto(updated!, store.groups.memberCount(id));
  });

  app.delete(
    '/api/groups/:id',
    (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const removed = store.groups.delete(request.params.id);
      if (!removed) throw notFound(`No group with id '${request.params.id}'.`);
      void reply.code(204);
      return null;
    },
  );

  app.get('/api/groups/:id/members', (request: FastifyRequest<{ Params: IdParams }>) => {
    const id = request.params.id;
    if (!store.groups.getById(id)) throw notFound(`No group with id '${id}'.`);
    const query = listQuerySchema.parse(request.query);
    const all = store.groups.listMembers(id);
    const page = all.slice(query.skip, query.skip + query.top);
    return toPaged(page.map(toUserDto), all.length, query.top, query.skip);
  });

  app.post(
    '/api/groups/:id/members',
    (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const id = request.params.id;
      if (!store.groups.getById(id)) throw notFound(`No group with id '${id}'.`);
      const body = memberAddSchema.parse(request.body);
      if (!store.users.getById(body.userId)) {
        throw invalidReference(`No user with id '${body.userId}'.`, 'userId');
      }
      store.groups.addMember(id, body.userId); // idempotent (INSERT OR IGNORE)
      void reply.code(204);
      return null;
    },
  );

  app.delete(
    '/api/groups/:id/members/:userId',
    (request: FastifyRequest<{ Params: MemberParams }>, reply: FastifyReply) => {
      const { id, userId } = request.params;
      if (!store.groups.getById(id)) throw notFound(`No group with id '${id}'.`);
      store.groups.removeMember(id, userId); // idempotent — absent membership is a no-op
      void reply.code(204);
      return null;
    },
  );
}
