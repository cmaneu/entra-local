import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/** Machine-readable admin error codes (owned by #11; distinct from OAuth/Graph error shapes). */
export type AdminErrorCode =
  | 'validation_error'
  | 'not_found'
  | 'conflict'
  | 'invalid_reference'
  | 'internal_error';

/** A single field-level validation issue (for multi-field `details[]`). */
export interface AdminFieldIssue {
  field: string;
  message: string;
}

/** The canonical admin error envelope body. */
export interface AdminErrorBody {
  error: {
    code: AdminErrorCode;
    message: string;
    target?: string;
    details?: AdminFieldIssue[];
  };
}

const STATUS_BY_CODE: Record<AdminErrorCode, number> = {
  validation_error: 400,
  invalid_reference: 400,
  not_found: 404,
  conflict: 409,
  internal_error: 500,
};

/**
 * A typed admin-API error. Thrown by route handlers and mapped to the admin error envelope by
 * {@link adminErrorHandler}. The HTTP status is derived from the {@link AdminErrorCode}.
 */
export class AdminError extends Error {
  readonly code: AdminErrorCode;
  readonly status: number;
  readonly target?: string;
  readonly details?: AdminFieldIssue[];

  constructor(
    code: AdminErrorCode,
    message: string,
    options: { target?: string; details?: AdminFieldIssue[] } = {},
  ) {
    super(message);
    this.name = 'AdminError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.target = options.target;
    this.details = options.details;
  }

  toBody(): AdminErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.target !== undefined ? { target: this.target } : {}),
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

/** `404 not_found`. */
export function notFound(message: string, target?: string): AdminError {
  return new AdminError('not_found', message, { target });
}

/** `409 conflict` (unique-constraint violation). */
export function conflict(message: string, target?: string): AdminError {
  return new AdminError('conflict', message, { target });
}

/** `400 invalid_reference` (FK target missing). */
export function invalidReference(message: string, target?: string): AdminError {
  return new AdminError('invalid_reference', message, { target });
}

/** `400 validation_error` with optional field-level details. */
export function validationError(
  message: string,
  details?: AdminFieldIssue[],
  target?: string,
): AdminError {
  return new AdminError('validation_error', message, { details, target });
}

/** Whether an unknown thrown value is a `node:sqlite` constraint error. */
function isSqliteError(err: unknown): err is Error & { code: string } {
  return err instanceof Error && (err as { code?: unknown }).code === 'ERR_SQLITE_ERROR';
}

/** Build a `ZodError` into an {@link AdminError} (`validation_error` with `details[]`). */
export function fromZodError(err: ZodError): AdminError {
  const details: AdminFieldIssue[] = err.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(body)',
    message: issue.message,
  }));
  const target = err.issues[0]?.path.join('.') || undefined;
  return validationError('Request validation failed.', details, target);
}

/**
 * Central admin error handler (registered on the `/admin` subtree). Maps thrown {@link AdminError}s,
 * zod validation failures, SQLite constraint violations, and Fastify body-parse errors onto the
 * admin error envelope; everything else becomes a generic `500 internal_error` (details logged).
 * Never leaks a raw stack or the SPA HTML shell.
 */
export function adminErrorHandler(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof AdminError) {
    void reply.code(error.status).send(error.toBody());
    return;
  }

  if (error instanceof ZodError) {
    const adminError = fromZodError(error);
    void reply.code(adminError.status).send(adminError.toBody());
    return;
  }

  if (isSqliteError(error)) {
    if (error.message.startsWith('UNIQUE')) {
      const adminError = conflict('A resource with the same unique value already exists.');
      void reply.code(adminError.status).send(adminError.toBody());
      return;
    }
    if (error.message.startsWith('FOREIGN KEY')) {
      const adminError = invalidReference('A referenced resource does not exist.');
      void reply.code(adminError.status).send(adminError.toBody());
      return;
    }
  }

  // Fastify content-type / body-parse failures arrive with a 4xx statusCode.
  const status = (error as { statusCode?: number }).statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const adminError = validationError('Malformed request body.');
    void reply.code(adminError.status).send(adminError.toBody());
    return;
  }

  request.log.error({ err: error }, 'Admin API internal error');
  const internal = new AdminError('internal_error', 'Internal server error.');
  void reply.code(internal.status).send(internal.toBody());
}

/** Not-found handler for unmatched `/admin/*` routes — admin envelope, never SPA HTML. */
export function adminNotFound(request: FastifyRequest, reply: FastifyReply): void {
  void reply.code(404).send(notFound(`No route for ${request.method} ${request.url}`).toBody());
}
