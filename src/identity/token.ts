import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config/schema.js';
import { TENANT_ENDPOINTS, tenantRoute } from '../http/pathmap.js';
import { tenantGuard } from '../http/tenant.js';
import type { Store } from '../store/store.js';
import { scopeNames } from '../tokens/claims.js';
import type { TokenService } from '../tokens/service.js';
import { authenticateClient, field, type Body } from './clientAuth.js';
import { autoGrantedRoles, resolveClientCredentialScope } from './clientCredentials.js';
import { DEVICE_CODE_GRANT, handleDeviceCodeGrant } from './deviceCode.js';
import { sendOAuthError } from './oauthErrors.js';

/**
 * `POST /{tenant}/oauth2/v2.0/token`: the token endpoint, multiplexed by `grant_type` via the
 * `GRANT_HANDLERS` dispatch table. #6 owns `authorization_code`; #7 adds `refresh_token` (silent
 * renewal with rotation + reuse detection); #8/#15 add `client_credentials`/`device_code`.
 * Client authentication (confidential `client_secret_post`/`client_secret_basic`; public clients
 * authenticate by `client_id` + possession only — presenting a secret is rejected) is shared via
 * `authenticateClient` (`clientAuth.ts`).
 *
 * All errors use the canonical AADSTS-style convention in `oauthErrors.ts` (`Cache-Control:
 * no-store`); success is `200 application/json` with `Cache-Control: no-store`, `Pragma: no-cache`.
 */

export interface TokenContext {
  store: Store;
  config: Config;
  tokenService: TokenService;
}

/** Resolve the request correlation id (echoed into AADSTS-style error bodies). */
function correlationId(request: FastifyRequest): string {
  const header = request.headers['client-request-id'] ?? request.headers['x-request-id'];
  return typeof header === 'string' ? header : String(request.id);
}

/** Handle `grant_type=authorization_code` (the #6 grant). */
async function handleAuthorizationCode(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: TokenContext,
  body: Body,
): Promise<void> {
  const cid = correlationId(request);

  const auth = authenticateClient(request, ctx.store, body);
  if ('failure' in auth) {
    sendOAuthError(reply, { ...auth.failure, correlationId: cid });
    return;
  }
  const app = auth.app;

  const code = field(body, 'code');
  const redirectUri = field(body, 'redirect_uri');
  if (!code) {
    sendOAuthError(reply, {
      error: 'invalid_request',
      description: 'Missing required parameter: code.',
      correlationId: cid,
    });
    return;
  }
  if (!redirectUri) {
    sendOAuthError(reply, {
      error: 'invalid_request',
      description: 'Missing required parameter: redirect_uri.',
      correlationId: cid,
    });
    return;
  }

  const codeVerifier = field(body, 'code_verifier');
  const redeem = ctx.tokenService.redeemAuthCode({
    code,
    appId: app.appId,
    redirectUri,
    codeVerifier: codeVerifier ?? null,
  });
  if (!redeem.ok) {
    sendOAuthError(reply, {
      error: 'invalid_grant',
      description: `The authorization code is invalid, expired, or already redeemed (${redeem.detail}).`,
      correlationId: cid,
    });
    return;
  }

  const user = ctx.store.users.getById(redeem.userId);
  if (!user) {
    sendOAuthError(reply, {
      error: 'invalid_grant',
      description: 'The user associated with this code no longer exists.',
      correlationId: cid,
    });
    return;
  }

  // Optional scope narrowing: a `scope` on the token request must be a subset of the granted scopes.
  const requestedScope = field(body, 'scope');
  if (requestedScope) {
    const granted = new Set(scopeNames(redeem.scopes));
    const requested = scopeNames(requestedScope.split(/\s+/).filter((s) => s.length > 0));
    if (!requested.every((name) => granted.has(name))) {
      sendOAuthError(reply, {
        error: 'invalid_scope',
        description: 'The requested scope exceeds the scope granted to the authorization code.',
        correlationId: cid,
      });
      return;
    }
  }

  const tokenResponse = await ctx.tokenService.buildTokenResponse({
    app,
    user,
    scopes: redeem.scopes,
    resource: redeem.resource,
    nonce: redeem.nonce,
    grant: 'authorization_code',
    ipAddress: request.ip,
  });

  // Entra parity: the token-response `scope` envelope echoes the granted scopes as requested
  // (fully-qualified resource scopes, e.g. `api://<id>/access_as_user`), while the access-token
  // `scp` claim carries the bare names (#5). MSAL keys its access-token cache off this envelope, so
  // preserving the qualified form is what lets `acquireTokenSilent` resolve from cache.
  if (redeem.scopes.length > 0) {
    tokenResponse.scope = redeem.scopes.join(' ');
  }

  void reply
    .code(200)
    .header('cache-control', 'no-store')
    .header('pragma', 'no-cache')
    .type('application/json')
    .send(tokenResponse);
}

/**
 * Handle `grant_type=refresh_token` (the #7 grant): rotate the presented refresh token and re-mint
 * the access (and ID, when `openid` is granted) token. The token service performs the atomic
 * rotation + reuse/replay detection (revoked → family revoked → `invalid_grant`); this handler
 * authenticates the client, enforces the `client_id`↔token binding (via `appId`), maps redemption
 * errors to the canonical convention, and embeds the rotated refresh token only when the (possibly
 * narrowed) grant still carries `offline_access`.
 */
async function handleRefreshToken(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: TokenContext,
  body: Body,
): Promise<void> {
  const cid = correlationId(request);

  const auth = authenticateClient(request, ctx.store, body);
  if ('failure' in auth) {
    sendOAuthError(reply, { ...auth.failure, correlationId: cid });
    return;
  }
  const app = auth.app;

  const refreshToken = field(body, 'refresh_token');
  if (!refreshToken) {
    sendOAuthError(reply, {
      error: 'invalid_request',
      description: 'Missing required parameter: refresh_token.',
      correlationId: cid,
    });
    return;
  }

  // Optional scope narrowing: a `scope` here must be a subset of the original grant (enforced by
  // the token service, which returns `invalid_scope` on an over-broad request).
  const requestedScope = field(body, 'scope');
  const requestedScopes = requestedScope
    ? requestedScope.split(/\s+/).filter((s) => s.length > 0)
    : undefined;

  // The token service rotates atomically and performs reuse/replay detection. A revoked/replayed
  // token triggers family revocation inside `redeemRefreshToken` and surfaces here as
  // `invalid_grant`; an over-broad scope surfaces as `invalid_scope`. The `client_id`↔token binding
  // is enforced via `appId` (a mismatch is `invalid_grant`).
  const redeem = ctx.tokenService.redeemRefreshToken({
    token: refreshToken,
    appId: app.appId,
    requestedScopes,
  });
  if (!redeem.ok) {
    sendOAuthError(reply, {
      error: redeem.error,
      description:
        redeem.error === 'invalid_scope'
          ? 'The requested scope exceeds the scope granted to the refresh token.'
          : `The refresh token is invalid, expired, revoked, or not bound to this client (${redeem.detail}).`,
      correlationId: cid,
    });
    return;
  }

  const user = ctx.store.users.getById(redeem.userId);
  if (!user) {
    sendOAuthError(reply, {
      error: 'invalid_grant',
      description: 'The user associated with this refresh token no longer exists.',
      correlationId: cid,
    });
    return;
  }

  // `offline_access` gating: the presented token is always rotated-and-revoked, but the freshly
  // minted successor is only returned to the client when the (possibly narrowed) grant still
  // carries `offline_access`. Pass it pre-issued so the response builder embeds it verbatim
  // (avoids double-issuance); pass `null` to suppress it (the orphan successor simply expires).
  const includeRefresh = scopeNames(redeem.scopes).includes('offline_access');
  const tokenResponse = await ctx.tokenService.buildTokenResponse({
    app,
    user,
    scopes: redeem.scopes,
    resource: redeem.resource,
    grant: 'refresh_token',
    refreshToken: includeRefresh ? redeem.newRefreshToken : null,
    ipAddress: request.ip,
  });

  // Preserve the fully-qualified granted scopes in the response envelope (the MSAL access-token
  // cache key), mirroring #6. The access-token `scp` keeps the bare names (#5).
  if (redeem.scopes.length > 0) {
    tokenResponse.scope = redeem.scopes.join(' ');
  }

  void reply
    .code(200)
    .header('cache-control', 'no-store')
    .header('pragma', 'no-cache')
    .type('application/json')
    .send(tokenResponse);
}

/**
 * Handle `grant_type=client_credentials` (the #8 grant): app-only access tokens for daemon/service
 * apps. The client must be a **confidential** app authenticated by `client_secret` (post or basic).
 * The single `<resource>/.default` scope is resolved to a token `aud` + resource app (#8's
 * resolution order, owned by `clientCredentials.ts`); the `roles` claim is auto-granted from the
 * resolved resource app's `Application`-type enabled roles. Mints an app-only token (no
 * `id_token`/`refresh_token`/`client_info`) and writes no rows.
 */
async function handleClientCredentials(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: TokenContext,
  body: Body,
): Promise<void> {
  const cid = correlationId(request);

  const auth = authenticateClient(request, ctx.store, body);
  if ('failure' in auth) {
    sendOAuthError(reply, { ...auth.failure, correlationId: cid });
    return;
  }
  const app = auth.app;

  // Client credentials is a confidential-only grant: a public client (which `authenticateClient`
  // admits without a secret) cannot mint app-only tokens.
  if (!app.isConfidential) {
    sendOAuthError(reply, {
      error: 'invalid_client',
      description: 'The client_credentials grant requires a confidential client.',
      correlationId: cid,
    });
    return;
  }

  const resolution = resolveClientCredentialScope(field(body, 'scope'), ctx.config, ctx.store);
  if (!resolution.ok) {
    sendOAuthError(reply, {
      error: resolution.error,
      description: resolution.description,
      correlationId: cid,
    });
    return;
  }
  const { aud, resourceApp } = resolution.resolved;
  const roles = autoGrantedRoles(resourceApp, ctx.store);

  const tokenResponse = await ctx.tokenService.buildTokenResponse({
    app,
    user: null,
    scopes: [],
    audience: aud,
    grant: 'client_credentials',
    roles,
  });

  // Echo the requested `<resource>/.default` scope verbatim (the response envelope), matching how
  // MSAL keys its app-only access-token cache. The minted token carries `roles`, not `scp`.
  tokenResponse.scope = field(body, 'scope') ?? '';

  void reply
    .code(200)
    .header('cache-control', 'no-store')
    .header('pragma', 'no-cache')
    .type('application/json')
    .send(tokenResponse);
}

/** Grant-type dispatch table. #7/#8/#15 register additional grants here. */
type GrantHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: TokenContext,
  body: Body,
) => void | Promise<void>;

const GRANT_HANDLERS: Record<string, GrantHandler> = {
  authorization_code: handleAuthorizationCode,
  refresh_token: handleRefreshToken,
  client_credentials: handleClientCredentials,
  // RFC 8628 mandates (and discovery advertises) the URN grant key. `@azure/msal-node`
  // (GrantType.DEVICE_CODE_GRANT) polls with the bare `device_code` value, so we accept both
  // aliases — they dispatch to the same handler — to interoperate with the real MSAL client.
  [DEVICE_CODE_GRANT]: handleDeviceCodeGrant,
  device_code: handleDeviceCodeGrant,
};

/**
 * Register the real `/token` handler (replacing the reserved `501` stub). Dispatches by
 * `grant_type`; an unknown/missing grant is `unsupported_grant_type` / `invalid_request`.
 */
export function registerTokenRoute(app: FastifyInstance): void {
  const ctx: TokenContext = {
    store: app.store,
    config: app.config,
    tokenService: app.tokenService,
  };

  app.post(
    tenantRoute(TENANT_ENDPOINTS.token),
    { preHandler: tenantGuard('oauth') },
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const body = (request.body ?? {}) as Body;
      const grantType = field(body, 'grant_type');
      if (!grantType) {
        sendOAuthError(reply, {
          error: 'invalid_request',
          description: 'Missing required parameter: grant_type.',
          correlationId: correlationId(request),
        });
        return;
      }
      const handler = GRANT_HANDLERS[grantType];
      if (!handler) {
        sendOAuthError(reply, {
          error: 'unsupported_grant_type',
          description: `The grant_type '${grantType}' is not supported.`,
          correlationId: correlationId(request),
        });
        return;
      }
      await handler(request, reply, ctx, body);
    },
  );
}
