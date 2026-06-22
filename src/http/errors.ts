import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/** Generic JSON error body used outside the OAuth surface. */
export interface GenericErrorBody {
  error: { code: string; message: string };
}

/** OAuth-style JSON error body used under `/{tenant}/oauth2/*` (full shape owned by #6). */
export interface OAuthErrorBody {
  error: string;
  error_description?: string;
}

/** Whether a request path is under the OAuth surface (drives error body shape). */
function isOAuthPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return /\/oauth2\/v2\.0\//.test(path);
}

/** Send a JSON 404 (used by prefixed not-found handlers — never returns SPA HTML). */
export function sendJsonNotFound(request: FastifyRequest, reply: FastifyReply): void {
  void reply.code(404).send({
    error: { code: 'not_found', message: `No route for ${request.method} ${request.url}` },
  } satisfies GenericErrorBody);
}

/**
 * Send a `501 Not Implemented` JSON stub. Per the Reserved-stub rule, #1 registers these for
 * every canonical OIDC/OAuth/UserInfo/Graph path so they always resolve to a registered route
 * (never the SPA / bare 404); each later feature replaces its stub with a real handler.
 */
export function sendNotImplemented(
  owner: string,
): (req: FastifyRequest, reply: FastifyReply) => void {
  return (request: FastifyRequest, reply: FastifyReply): void => {
    void reply.code(501).send({
      error: {
        code: 'not_implemented',
        message: `${request.method} ${request.url} is reserved and implemented by feature ${owner}.`,
      },
    } satisfies GenericErrorBody);
  };
}

/**
 * Central error handler. Emits OAuth-style JSON under the OAuth surface and generic JSON
 * elsewhere. Validation errors → 400; unhandled → 500 with a generic message (details logged).
 */
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const statusCode = error.statusCode ?? (error.validation ? 400 : 500);

  if (statusCode >= 500) {
    request.log.error({ err: error }, 'Unhandled error');
  } else {
    request.log.warn({ err: error }, 'Request error');
  }

  if (isOAuthPath(request.url)) {
    const body: OAuthErrorBody = {
      error: statusCode === 400 ? 'invalid_request' : 'server_error',
      error_description: statusCode >= 500 ? 'Internal server error.' : error.message,
    };
    void reply.code(statusCode).send(body);
    return;
  }

  const message = statusCode >= 500 ? 'Internal server error.' : error.message;
  void reply.code(statusCode).send({
    error: { code: error.code ?? 'error', message },
  } satisfies GenericErrorBody);
}
