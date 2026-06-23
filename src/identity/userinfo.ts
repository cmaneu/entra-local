import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import type { Config } from '../config/schema.js';
import type { Store } from '../store/store.js';
import type { TokenService } from '../tokens/service.js';
import { extractBearer } from './bearer.js';

/**
 * OIDC UserInfo endpoint (feature #9): `GET|POST /graph/oidc/userinfo`. Validates the Bearer access
 * token via the #5 token service (signature/issuer/expiry/audience), requires a **delegated** token
 * (one carrying `oid`), resolves the user, and returns the standard OIDC profile claims. Replaces
 * the reserved `501` stub advertised by discovery (#4) as `userinfo_endpoint`.
 *
 * Errors follow RFC 6750 Bearer style: a `WWW-Authenticate` header plus a matching JSON body. An
 * app-only token (no `oid`) is rejected with `403 insufficient_scope` because UserInfo requires a
 * user; every other validation failure is `401 invalid_token`.
 */

export interface UserInfoDeps {
  store: Store;
  tokenService: TokenService;
  config: Config;
}

/** UserInfo success body. Optional claims are omitted (not null) when the user has no value. */
export interface UserInfoResponse {
  sub: string;
  oid: string;
  tid: string;
  name: string;
  preferred_username: string;
  given_name?: string;
  family_name?: string;
  email?: string;
}

/** RFC 6750 Bearer error (`401 invalid_token` / `403 insufficient_scope`) with matching JSON body. */
function sendBearerError(
  reply: FastifyReply,
  status: 401 | 403,
  error: 'invalid_token' | 'insufficient_scope',
  description: string,
): void {
  void reply
    .code(status)
    .header('www-authenticate', `Bearer error="${error}", error_description="${description}"`)
    .header('cache-control', 'no-store')
    .type('application/json')
    .send({ error, error_description: description });
}

/**
 * Build the shared `GET`/`POST` UserInfo handler bound to the store, token service and config. POST
 * behaves identically to GET (OIDC parity); neither reads a request body.
 */
export function createUserInfoHandler(deps: UserInfoDeps): RouteHandlerMethod {
  const { store, tokenService, config } = deps;

  return async function userInfo(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const bearer = extractBearer(request.headers.authorization);
    if (!bearer) {
      sendBearerError(reply, 401, 'invalid_token', 'A Bearer access token is required.');
      return;
    }

    const result = await tokenService.validateAccessToken(bearer, {
      audience: config.graphResourceId,
    });
    if (!result.valid) {
      sendBearerError(reply, 401, 'invalid_token', 'The access token is invalid or expired.');
      return;
    }

    const { claims } = result;
    if (claims.oid == null || claims.oid === '') {
      sendBearerError(
        reply,
        403,
        'insufficient_scope',
        'UserInfo requires a delegated user token.',
      );
      return;
    }

    const user = store.users.getById(claims.oid);
    if (!user || !user.accountEnabled) {
      sendBearerError(reply, 401, 'invalid_token', 'The user could not be found.');
      return;
    }

    const body: UserInfoResponse = {
      sub: claims.sub,
      oid: user.id,
      tid: claims.tid,
      name: user.displayName,
      preferred_username: user.userPrincipalName,
      ...(user.givenName != null ? { given_name: user.givenName } : {}),
      ...(user.surname != null ? { family_name: user.surname } : {}),
      ...(user.mail != null ? { email: user.mail } : {}),
    };

    void reply.code(200).header('cache-control', 'no-store').type('application/json').send(body);
  };
}
