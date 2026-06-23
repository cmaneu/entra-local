import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { NewUser, UserUpdate } from '../store/types.js';
import { toGroupDto, toPaged, toUserDto } from './dto.js';
import { conflict, notFound } from './errors.js';
import { listQuerySchema, userCreateSchema, userPatchSchema } from './schemas.js';

interface IdParams {
  id: string;
}

/** Register `/admin/api/users` routes on the admin (sub-)instance. */
export function registerUserRoutes(app: FastifyInstance): void {
  const { store } = app;
  const tenantId = app.config.tenantId;

  app.get('/api/users', (request: FastifyRequest) => {
    const query = listQuerySchema.parse(request.query);
    const value = store.users
      .list({ top: query.top, skip: query.skip, search: query.search })
      .map(toUserDto);
    const count = store.users.count({ search: query.search });
    return toPaged(value, count, query.top, query.skip);
  });

  app.post('/api/users', (request: FastifyRequest, reply: FastifyReply) => {
    const body = userCreateSchema.parse(request.body);
    if (store.users.getByUpn(body.userPrincipalName)) {
      throw conflict(
        `A user with userPrincipalName '${body.userPrincipalName}' already exists.`,
        'userPrincipalName',
      );
    }
    const input: NewUser = {
      tenantId,
      userPrincipalName: body.userPrincipalName,
      displayName: body.displayName,
      givenName: body.givenName ?? null,
      surname: body.surname ?? null,
      mail: body.mail ?? null,
      accountEnabled: body.accountEnabled,
      password: body.password ?? null,
    };
    const created = store.users.create(input);
    void reply.code(201);
    return toUserDto(created);
  });

  app.get('/api/users/:id', (request: FastifyRequest<{ Params: IdParams }>) => {
    const user = store.users.getById(request.params.id);
    if (!user) throw notFound(`No user with id '${request.params.id}'.`);
    return toUserDto(user);
  });

  app.patch('/api/users/:id', (request: FastifyRequest<{ Params: IdParams }>) => {
    const id = request.params.id;
    const existing = store.users.getById(id);
    if (!existing) throw notFound(`No user with id '${id}'.`);

    const body = userPatchSchema.parse(request.body);
    if (body.userPrincipalName !== undefined) {
      const clash = store.users.getByUpn(body.userPrincipalName);
      if (clash && clash.id !== id) {
        throw conflict(
          `A user with userPrincipalName '${body.userPrincipalName}' already exists.`,
          'userPrincipalName',
        );
      }
    }
    const patch: UserUpdate = body;
    const updated = store.users.update(id, patch);
    return toUserDto(updated!);
  });

  app.delete(
    '/api/users/:id',
    (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const removed = store.users.delete(request.params.id);
      if (!removed) throw notFound(`No user with id '${request.params.id}'.`);
      void reply.code(204);
      return null;
    },
  );

  app.get('/api/users/:id/groups', (request: FastifyRequest<{ Params: IdParams }>) => {
    const id = request.params.id;
    if (!store.users.getById(id)) throw notFound(`No user with id '${id}'.`);
    const query = listQuerySchema.parse(request.query);
    const all = store.groups.listGroupsForUser(id);
    const page = all.slice(query.skip, query.skip + query.top);
    const value = page.map((g) => toGroupDto(g, store.groups.memberCount(g.id)));
    return toPaged(value, all.length, query.top, query.skip);
  });
}
