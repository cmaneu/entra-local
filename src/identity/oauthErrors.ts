import { randomUUID } from 'node:crypto';
import type { FastifyReply } from 'fastify';

/**
 * Canonical OAuth/OIDC error-response convention for the STS endpoints (`/authorize`, `/token`).
 *
 * Owned by feature #6 and reused verbatim by #7 (refresh), #8 (client credentials) and #15
 * (device code). Token-endpoint errors are JSON with an AADSTS-style shape
 * (`error`/`error_description`/`error_codes`/`timestamp`/`trace_id`/`correlation_id`) and always
 * carry `Cache-Control: no-store` + `Pragma: no-cache`, matching how MSAL parses Entra errors.
 *
 * The numeric `error_codes` mimic Entra's `AADSTSxxxxx` numbering closely enough for MSAL error
 * handling; exact parity with Microsoft's codes is best-effort (documented in the spec).
 */

/** The canonical OAuth error codes emitted by the STS endpoints. */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'server_error';

/** Default HTTP status per error code (per the spec error table). */
const DEFAULT_STATUS: Record<OAuthErrorCode, number> = {
  invalid_request: 400,
  invalid_client: 401,
  invalid_grant: 400,
  unauthorized_client: 400,
  unsupported_grant_type: 400,
  invalid_scope: 400,
  server_error: 500,
};

/** Default AADSTS-style numeric code per error (best-effort parity with Entra). */
const DEFAULT_AADSTS: Record<OAuthErrorCode, number> = {
  invalid_request: 900144,
  invalid_client: 7000215,
  invalid_grant: 70008,
  unauthorized_client: 700016,
  unsupported_grant_type: 70003,
  invalid_scope: 70011,
  server_error: 90099,
};

/** The AADSTS-style JSON error body returned by the token endpoint. */
export interface OAuthErrorResponse {
  error: OAuthErrorCode;
  error_description: string;
  error_codes: number[];
  timestamp: string;
  trace_id: string;
  correlation_id: string;
}

export interface OAuthErrorOptions {
  error: OAuthErrorCode;
  description: string;
  /** Override the default HTTP status for this error code. */
  status?: number;
  /** Override the default AADSTS numeric code(s). */
  errorCodes?: number[];
  /** Correlation id to echo (from the request); a fresh uuid is generated when omitted. */
  correlationId?: string;
}

/** Build the AADSTS-style error body (without sending it). */
export function buildOAuthError(options: OAuthErrorOptions): OAuthErrorResponse {
  const codes = options.errorCodes ?? [DEFAULT_AADSTS[options.error]];
  return {
    error: options.error,
    error_description: options.description,
    error_codes: codes,
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    trace_id: randomUUID(),
    correlation_id: options.correlationId ?? randomUUID(),
  };
}

/**
 * Send a canonical AADSTS-style OAuth error response: the JSON body above with the documented HTTP
 * status and the mandatory `Cache-Control: no-store` / `Pragma: no-cache` headers.
 */
export function sendOAuthError(reply: FastifyReply, options: OAuthErrorOptions): FastifyReply {
  const status = options.status ?? DEFAULT_STATUS[options.error];
  const body = buildOAuthError(options);
  void reply
    .code(status)
    .header('cache-control', 'no-store')
    .header('pragma', 'no-cache')
    .type('application/json')
    .send(body);
  return reply;
}
