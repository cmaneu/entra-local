import { compactVerify, decodeProtectedHeader, errors as joseErrors } from 'jose';
import type { Config } from '../config/schema.js';
import type { AccessTokenClaims } from './claims.js';
import { SIGNING_ALG } from './keys.js';
import type { SigningService } from './keys.js';

/**
 * Access-token validation (spec #5 validation contract), consumed by #9 (userinfo) and #10 (graph).
 * Verifies signature against the JWKS (#3), enforces `alg=RS256`, issuer, audience, `exp`/`nbf`
 * (±60s skew), and optional required scopes/roles. Returns a typed result so callers map failures
 * to `401`/`403` with `WWW-Authenticate` themselves (error shape owned by #9/#10).
 */

/** ±60s tolerance applied to `exp`/`nbf` comparisons (spec assumption). */
export const CLOCK_SKEW_SECONDS = 60;

/** Typed validation failure reasons. Callers map signature/issuer/audience/expiry → 401; scope/role → 403. */
export enum TokenValidationError {
  /** Not a parseable compact JWT (or missing). */
  Malformed = 'malformed_token',
  /** Header `alg` is not RS256. */
  InvalidAlgorithm = 'invalid_algorithm',
  /** Header `kid` is missing or unknown to the JWKS. */
  UnknownKey = 'unknown_key',
  /** Signature verification failed. */
  InvalidSignature = 'invalid_signature',
  /** `iss` does not match the emulator issuer. */
  InvalidIssuer = 'invalid_issuer',
  /** `exp` is in the past (beyond skew). */
  Expired = 'token_expired',
  /** `nbf` is in the future (beyond skew). */
  NotYetValid = 'token_not_yet_valid',
  /** `aud` is not among the accepted audiences. */
  InvalidAudience = 'invalid_audience',
  /** A required scope is absent from `scp`. */
  InsufficientScope = 'insufficient_scope',
  /** A required role is absent from `roles`. */
  InsufficientRole = 'insufficient_role',
}

export interface ValidateAccessTokenOptions {
  /** Accepted audience(s). Defaults to the configured Graph resource id. */
  audience?: string | readonly string[];
  /** Every listed scope must be present in `scp`. */
  requiredScopes?: readonly string[];
  /** Every listed role must be present in `roles`. */
  requiredRoles?: readonly string[];
}

export type ValidateAccessTokenResult =
  | { valid: true; claims: AccessTokenClaims }
  | { valid: false; error: TokenValidationError; detail: string };

/** Strip an optional `Bearer ` prefix and surrounding whitespace from an authorization value. */
function stripBearer(bearer: string): string {
  const trimmed = bearer.trim();
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  return match ? (match[1] as string).trim() : trimmed;
}

function fail(error: TokenValidationError, detail: string): ValidateAccessTokenResult {
  return { valid: false, error, detail };
}

export interface AccessTokenValidator {
  (bearer: string, opts?: ValidateAccessTokenOptions): Promise<ValidateAccessTokenResult>;
}

/**
 * Build the `validateAccessToken` function bound to the signing service, config and an injected
 * clock (seconds). The clock makes `exp`/`nbf` checks deterministic in tests.
 */
export function createAccessTokenValidator(
  signing: SigningService,
  config: Config,
  issuer: string,
  clock: () => number,
): AccessTokenValidator {
  return async function validateAccessToken(bearer, opts = {}) {
    const token = stripBearer(bearer ?? '');
    if (!token || token.split('.').length !== 3) {
      return fail(TokenValidationError.Malformed, 'not a compact JWS');
    }

    let header: ReturnType<typeof decodeProtectedHeader>;
    try {
      header = decodeProtectedHeader(token);
    } catch {
      return fail(TokenValidationError.Malformed, 'unparseable header');
    }
    if (header.alg !== SIGNING_ALG) {
      return fail(TokenValidationError.InvalidAlgorithm, `alg ${String(header.alg)} not allowed`);
    }
    if (typeof header.kid !== 'string' || header.kid.length === 0) {
      return fail(TokenValidationError.UnknownKey, 'missing kid');
    }

    let key: Awaited<ReturnType<SigningService['getVerificationKey']>>;
    try {
      key = await signing.getVerificationKey(header.kid);
    } catch {
      return fail(TokenValidationError.UnknownKey, `unknown kid ${header.kid}`);
    }

    let claims: AccessTokenClaims & Record<string, unknown>;
    try {
      const { payload } = await compactVerify(token, key, { algorithms: [SIGNING_ALG] });
      claims = JSON.parse(new TextDecoder().decode(payload)) as AccessTokenClaims &
        Record<string, unknown>;
    } catch (err) {
      if (err instanceof joseErrors.JOSEAlgNotAllowed) {
        return fail(TokenValidationError.InvalidAlgorithm, 'alg not allowed');
      }
      return fail(TokenValidationError.InvalidSignature, 'signature verification failed');
    }

    if (claims.iss !== issuer) {
      return fail(TokenValidationError.InvalidIssuer, `iss ${String(claims.iss)} != ${issuer}`);
    }

    const now = clock();
    if (typeof claims.exp === 'number' && now > claims.exp + CLOCK_SKEW_SECONDS) {
      return fail(TokenValidationError.Expired, 'token expired');
    }
    if (typeof claims.nbf === 'number' && now < claims.nbf - CLOCK_SKEW_SECONDS) {
      return fail(TokenValidationError.NotYetValid, 'token not yet valid');
    }

    const accepted =
      opts.audience === undefined
        ? [config.graphResourceId]
        : Array.isArray(opts.audience)
          ? opts.audience
          : [opts.audience as string];
    if (!accepted.includes(claims.aud)) {
      return fail(TokenValidationError.InvalidAudience, `aud ${String(claims.aud)} not accepted`);
    }

    if (opts.requiredScopes && opts.requiredScopes.length > 0) {
      const granted = new Set((claims.scp ?? '').split(' ').filter(Boolean));
      const missing = opts.requiredScopes.find((s) => !granted.has(s));
      if (missing !== undefined) {
        return fail(TokenValidationError.InsufficientScope, `missing scope ${missing}`);
      }
    }
    if (opts.requiredRoles && opts.requiredRoles.length > 0) {
      const granted = new Set(claims.roles ?? []);
      const missing = opts.requiredRoles.find((r) => !granted.has(r));
      if (missing !== undefined) {
        return fail(TokenValidationError.InsufficientRole, `missing role ${missing}`);
      }
    }

    return { valid: true, claims };
  };
}
