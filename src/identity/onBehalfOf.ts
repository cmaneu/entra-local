import type { FastifyReply, FastifyRequest } from 'fastify';
import { authenticateClient, field, type Body } from './clientAuth.js';
import { sendOAuthError } from './oauthErrors.js';
import { OIDC_SCOPES, scopesAreValid, splitScopes } from './scopes.js';
import type { TokenContext } from './token.js';

export const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
export const OBO_TOKEN_USE = 'on_behalf_of';

function scopeResource(scope: string, graphResourceId: string): string {
  const scheme = scope.indexOf('://');
  if (scheme === -1) return graphResourceId;
  const slash = scope.lastIndexOf('/');
  return slash > scheme + 2 ? scope.slice(0, slash) : scope;
}

/** Handle delegated JWT bearer token exchange without persisting the assertion or grant. */
export async function handleOnBehalfOfGrant(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: TokenContext,
  body: Body,
  correlationId: string,
): Promise<void> {
  const auth = authenticateClient(request, ctx.store, body);
  if ('failure' in auth) {
    sendOAuthError(reply, { ...auth.failure, correlationId });
    return;
  }
  const app = auth.app;
  if (!app.isConfidential) {
    sendOAuthError(reply, {
      error: 'invalid_client',
      description: 'The on-behalf-of grant requires a confidential client.',
      correlationId,
    });
    return;
  }

  const assertion = field(body, 'assertion');
  const scope = field(body, 'scope');
  const requestedTokenUse = field(body, 'requested_token_use');
  if (!assertion) {
    sendOAuthError(reply, {
      error: 'invalid_request',
      description: 'Missing required parameter: assertion.',
      correlationId,
    });
    return;
  }
  if (!scope) {
    sendOAuthError(reply, {
      error: 'invalid_request',
      description: 'Missing required parameter: scope.',
      correlationId,
    });
    return;
  }
  if (requestedTokenUse !== OBO_TOKEN_USE) {
    sendOAuthError(reply, {
      error: 'invalid_request',
      description: `The requested_token_use parameter must be '${OBO_TOKEN_USE}'.`,
      correlationId,
    });
    return;
  }

  const scopes = splitScopes(scope);
  // MSAL Node appends its protocol-default OIDC scopes to OBO requests. They are not downstream
  // permissions and are never issued; tolerate and remove them so the real client interoperates.
  const resourceScopes = scopes.filter((value) => !OIDC_SCOPES.has(value));
  const invalidGrantScope = resourceScopes.find(
    (value) => value === '.default' || value.toLowerCase().endsWith('/.default'),
  );
  if (
    resourceScopes.length === 0 ||
    invalidGrantScope !== undefined ||
    !scopesAreValid(resourceScopes, ctx.store, ctx.config)
  ) {
    sendOAuthError(reply, {
      error: 'invalid_scope',
      description:
        'OBO scope must contain enabled delegated API scopes for one resource and cannot use .default.',
      correlationId,
    });
    return;
  }

  const resources = new Set(
    resourceScopes.map((value) => scopeResource(value, ctx.config.graphResourceId)),
  );
  if (resources.size !== 1) {
    sendOAuthError(reply, {
      error: 'invalid_scope',
      description: 'All OBO scopes must target one downstream resource.',
      correlationId,
    });
    return;
  }

  const validation = await ctx.tokenService.validateAccessToken(assertion, {
    audience: app.appId,
  });
  if (!validation.valid) {
    sendOAuthError(reply, {
      error: 'invalid_grant',
      description: `The OBO assertion is invalid (${validation.error}).`,
      correlationId,
    });
    return;
  }

  const claims = validation.claims;
  const delegated =
    typeof claims.oid === 'string' &&
    claims.oid.length > 0 &&
    typeof claims.scp === 'string' &&
    claims.scp.trim().length > 0;
  if (
    !delegated ||
    typeof claims.exp !== 'number' ||
    claims.tid !== ctx.config.tenantId ||
    claims.roles !== undefined
  ) {
    sendOAuthError(reply, {
      error: 'invalid_grant',
      description: 'The OBO assertion must be a valid delegated token from this tenant.',
      correlationId,
    });
    return;
  }

  const user = ctx.store.users.getById(claims.oid!);
  if (!user || !user.accountEnabled || user.tenantId !== ctx.config.tenantId) {
    sendOAuthError(reply, {
      error: 'invalid_grant',
      description: 'The user represented by the OBO assertion is missing or disabled.',
      correlationId,
    });
    return;
  }

  const resource = [...resources][0]!;
  const tokenResponse = await ctx.tokenService.buildTokenResponse({
    app,
    user,
    scopes: resourceScopes,
    resource,
    grant: 'on_behalf_of',
    ipAddress: request.ip,
  });
  tokenResponse.scope = resourceScopes.join(' ');

  void reply
    .code(200)
    .header('cache-control', 'no-store')
    .header('pragma', 'no-cache')
    .type('application/json')
    .send(tokenResponse);
}
