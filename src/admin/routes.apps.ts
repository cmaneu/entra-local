import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppRegistration, NewApp } from '../store/types.js';
import {
  toAppDto,
  toPaged,
  toRedirectUriDto,
  toRoleDto,
  toScopeDto,
  toSecretCreatedDto,
  type AppDto,
} from './dto.js';
import { conflict, notFound } from './errors.js';
import {
  appCreateSchema,
  appPatchSchema,
  listQuerySchema,
  redirectUriCreateSchema,
  roleCreateSchema,
  rolePatchSchema,
  scopeCreateSchema,
  scopePatchSchema,
  secretCreateSchema,
  tokenPreviewSchema,
} from './schemas.js';
import { GROUP_MEMBERSHIP_CLAIMS_VALUES } from '../store/types.js';
import {
  SUPPORTED_ACCESS_TOKEN_CLAIMS,
  SUPPORTED_ID_TOKEN_CLAIMS,
} from '../tokens/tokenConfig.js';

interface IdParams {
  id: string;
}
interface SubParams {
  id: string;
  subId: string;
}

const SECONDS_PER_DAY = 86_400;

/** Generate a high-entropy app secret (URL-safe). */
function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Build the full App DTO including all sub-collections. */
function loadAppDto(app: FastifyInstance, registration: AppRegistration): AppDto {
  const { store } = app;
  return toAppDto(registration, {
    redirectUris: store.apps.listRedirectUris(registration.appId),
    scopes: store.apps.listScopes(registration.appId),
    roles: store.apps.listRoles(registration.appId),
    secrets: store.apps.listSecrets(registration.appId),
  });
}

/** Register `/admin/api/apps` routes (incl. sub-resources) on the admin (sub-)instance. */
export function registerAppRoutes(app: FastifyInstance): void {
  const { store } = app;
  const tenantId = app.config.tenantId;

  const requireApp = (id: string): AppRegistration => {
    const registration = store.apps.getByAppId(id);
    if (!registration) throw notFound(`No app with id '${id}'.`);
    return registration;
  };

  app.get('/api/apps', (request: FastifyRequest) => {
    const query = listQuerySchema.parse(request.query);
    const value = store.apps
      .list({ top: query.top, skip: query.skip, search: query.search })
      .map((registration) => loadAppDto(app, registration));
    const count = store.apps.count({ search: query.search });
    return toPaged(value, count, query.top, query.skip);
  });

  app.post('/api/apps', (request: FastifyRequest, reply: FastifyReply) => {
    const body = appCreateSchema.parse(request.body);
    if (body.appIdUri && store.apps.getByAppIdUri(body.appIdUri)) {
      throw conflict(`appIdUri '${body.appIdUri}' is already used by another app.`, 'appIdUri');
    }
    const input: NewApp = {
      tenantId,
      displayName: body.displayName,
      isConfidential: body.isConfidential,
      appIdUri: body.appIdUri ?? null,
    };
    const created = store.apps.create(input);
    for (const redirect of body.redirectUris ?? []) {
      store.apps.addRedirectUri(created.appId, redirect.uri, redirect.type);
    }
    void reply.code(201);
    return loadAppDto(app, created);
  });

  app.get('/api/apps/:id', (request: FastifyRequest<{ Params: IdParams }>) => {
    return loadAppDto(app, requireApp(request.params.id));
  });

  app.patch('/api/apps/:id', (request: FastifyRequest<{ Params: IdParams }>) => {
    const registration = requireApp(request.params.id);
    const body = appPatchSchema.parse(request.body);
    if (body.appIdUri != null) {
      const clash = store.apps.getByAppIdUri(body.appIdUri);
      if (clash && clash.appId !== registration.appId) {
        throw conflict(`appIdUri '${body.appIdUri}' is already used by another app.`, 'appIdUri');
      }
    }
    const updated = store.apps.update(registration.appId, body);
    return loadAppDto(app, updated!);
  });

  app.delete(
    '/api/apps/:id',
    (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const removed = store.apps.delete(request.params.id);
      if (!removed) throw notFound(`No app with id '${request.params.id}'.`);
      void reply.code(204);
      return null;
    },
  );

  // --- Redirect URIs ----------------------------------------------------------------------------

  app.post(
    '/api/apps/:id/redirectUris',
    (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const registration = requireApp(request.params.id);
      const body = redirectUriCreateSchema.parse(request.body);
      if (store.apps.listRedirectUris(registration.appId).some((r) => r.uri === body.uri)) {
        throw conflict(`Redirect URI '${body.uri}' already exists for this app.`, 'uri');
      }
      const created = store.apps.addRedirectUri(registration.appId, body.uri, body.type);
      void reply.code(201);
      return toRedirectUriDto(created);
    },
  );

  app.delete(
    '/api/apps/:id/redirectUris/:subId',
    (request: FastifyRequest<{ Params: SubParams }>, reply: FastifyReply) => {
      const registration = requireApp(request.params.id);
      const uriId = Number(request.params.subId);
      const removed =
        Number.isInteger(uriId) && store.apps.removeRedirectUriById(registration.appId, uriId);
      if (!removed) throw notFound(`No redirect URI '${request.params.subId}' for this app.`);
      void reply.code(204);
      return null;
    },
  );

  // --- Secrets (show-once) ----------------------------------------------------------------------

  app.post(
    '/api/apps/:id/secrets',
    (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const registration = requireApp(request.params.id);
      const body = secretCreateSchema.parse(request.body);
      const expiresAt =
        body.expiresInDays != null
          ? Math.floor(Date.now() / 1000) + body.expiresInDays * SECONDS_PER_DAY
          : null;
      const created = store.apps.addSecret(registration.appId, {
        displayName: body.displayName ?? null,
        plaintext: generateSecret(),
        expiresAt,
      });
      void reply.code(201);
      return toSecretCreatedDto(created);
    },
  );

  app.delete(
    '/api/apps/:id/secrets/:subId',
    (request: FastifyRequest<{ Params: SubParams }>, reply: FastifyReply) => {
      const registration = requireApp(request.params.id);
      const removed = store.apps.removeSecret(registration.appId, request.params.subId);
      if (!removed) throw notFound(`No secret '${request.params.subId}' for this app.`);
      void reply.code(204);
      return null;
    },
  );

  // --- Exposed scopes ---------------------------------------------------------------------------

  app.post(
    '/api/apps/:id/scopes',
    (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const registration = requireApp(request.params.id);
      const body = scopeCreateSchema.parse(request.body);
      if (store.apps.listScopes(registration.appId).some((s) => s.value === body.value)) {
        throw conflict(`Scope '${body.value}' already exists for this app.`, 'value');
      }
      const created = store.apps.addScope(registration.appId, {
        value: body.value,
        adminConsentDisplayName: body.adminConsentDisplayName ?? null,
        isEnabled: body.isEnabled,
      });
      void reply.code(201);
      return toScopeDto(created);
    },
  );

  app.patch('/api/apps/:id/scopes/:subId', (request: FastifyRequest<{ Params: SubParams }>) => {
    const registration = requireApp(request.params.id);
    const body = scopePatchSchema.parse(request.body);
    const updated = store.apps.updateScope(registration.appId, request.params.subId, body);
    if (!updated) throw notFound(`No scope '${request.params.subId}' for this app.`);
    return toScopeDto(updated);
  });

  app.delete(
    '/api/apps/:id/scopes/:subId',
    (request: FastifyRequest<{ Params: SubParams }>, reply: FastifyReply) => {
      const registration = requireApp(request.params.id);
      const removed = store.apps.removeScope(registration.appId, request.params.subId);
      if (!removed) throw notFound(`No scope '${request.params.subId}' for this app.`);
      void reply.code(204);
      return null;
    },
  );

  // --- App roles --------------------------------------------------------------------------------

  app.post(
    '/api/apps/:id/roles',
    (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const registration = requireApp(request.params.id);
      const body = roleCreateSchema.parse(request.body);
      if (store.apps.listRoles(registration.appId).some((r) => r.value === body.value)) {
        throw conflict(`Role '${body.value}' already exists for this app.`, 'value');
      }
      const created = store.apps.addRole(registration.appId, {
        value: body.value,
        displayName: body.displayName ?? null,
        allowedMemberTypes: body.allowedMemberTypes.join(','),
        isEnabled: body.isEnabled,
      });
      void reply.code(201);
      return toRoleDto(created);
    },
  );

  app.patch('/api/apps/:id/roles/:subId', (request: FastifyRequest<{ Params: SubParams }>) => {
    const registration = requireApp(request.params.id);
    const body = rolePatchSchema.parse(request.body);
    const updated = store.apps.updateRole(registration.appId, request.params.subId, {
      displayName: body.displayName,
      allowedMemberTypes: body.allowedMemberTypes?.join(','),
      isEnabled: body.isEnabled,
    });
    if (!updated) throw notFound(`No role '${request.params.subId}' for this app.`);
    return toRoleDto(updated);
  });

  app.delete(
    '/api/apps/:id/roles/:subId',
    (request: FastifyRequest<{ Params: SubParams }>, reply: FastifyReply) => {
      const registration = requireApp(request.params.id);
      const removed = store.apps.removeRole(registration.appId, request.params.subId);
      if (!removed) throw notFound(`No role '${request.params.subId}' for this app.`);
      void reply.code(204);
      return null;
    },
  );

  // --- Token configuration ----------------------------------------------------------------------

  // Supported optional claims + group-membership modes (portal distinguishes supported claims and
  // shows the default group overage limit). Static metadata; independent of any specific app.
  app.get('/api/token-configuration/supported-claims', () => ({
    idToken: [...SUPPORTED_ID_TOKEN_CLAIMS],
    accessToken: [...SUPPORTED_ACCESS_TOKEN_CLAIMS],
    groupMembershipClaims: [...GROUP_MEMBERSHIP_CLAIMS_VALUES],
    defaultGroupOverageLimit: app.config.groupOverageLimit,
  }));

  // Decoded token-claims preview for a selected user + token type. The preview applies the app's
  // configured optional/group claims exactly as issuance would, so it provably matches the token.
  app.post('/api/apps/:id/token-preview', (request: FastifyRequest<{ Params: IdParams }>) => {
    const registration = requireApp(request.params.id);
    const body = tokenPreviewSchema.parse(request.body);
    const user = store.users.getById(body.userId) ?? store.users.getByUpn(body.userId);
    if (!user) throw notFound(`No user with id '${body.userId}'.`);
    const preview = app.tokenService.previewToken({
      app: registration,
      user,
      tokenType: body.tokenType,
    });
    return {
      tokenType: body.tokenType,
      userId: user.id,
      claims: preview.claims,
      unsupportedClaims: preview.unsupportedClaims,
      groupOverage: preview.groupOverage,
    };
  });
}
