import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TENANT_ENDPOINTS, tenantRoute } from '../http/pathmap.js';
import { tenantGuard } from '../http/tenant.js';
import { sha256 } from '../store/hashing.js';
import { generateOpaqueToken } from '../tokens/authCode.js';
import { authenticateClient, field, type Body } from './clientAuth.js';
import { registerDeviceApprovalRoutes } from './deviceApproval.js';
import { sendOAuthError } from './oauthErrors.js';
import { resolveResource, scopesAreValid, splitScopes } from './scopes.js';
import type { TokenContext } from './token.js';

/**
 * RFC 8628 Device Authorization Grant (#15).
 *
 * - `POST /{tenant}/oauth2/v2.0/devicecode` (endpoint A): a CLI/device public client obtains a
 *   `device_code` + a short human `user_code` + a `verification_uri`. The `device_code` is opaque
 *   (256-bit) and stored **hashed** (SHA-256); the `user_code` is plaintext and human-transcribable.
 * - `handleDeviceCodeGrant`: the `grant_type=urn:ietf:params:oauth:grant-type:device_code` polling
 *   handler plugged into `/token`'s dispatch table. Maps the device-code lifecycle to RFC 8628 §3.5
 *   responses and atomically redeems an approved code (single-use, no double-mint).
 */

/** The exact `grant_type` URN `@azure/msal-node` sends (RFC 8628 §3.4); the dispatch key. */
export const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** Ambiguity-reduced user-code charset (20 consonants; no vowels/0/1/O/I/L/U). */
const USER_CODE_CHARSET = 'BCDFGHJKLMNPQRSTVWXZ';
/** Bounded retries on the (rare) `user_code` UNIQUE collision. */
const USER_CODE_MAX_ATTEMPTS = 10;

/** Current time as integer Unix epoch seconds. */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Resolve the request correlation id (echoed into AADSTS-style error bodies). */
function correlationId(request: FastifyRequest): string {
  const header = request.headers['client-request-id'] ?? request.headers['x-request-id'];
  return typeof header === 'string' ? header : String(request.id);
}

/** Generate a fresh `user_code` in canonical `XXXX-XXXX` form. */
function generateUserCode(): string {
  let raw = '';
  for (let i = 0; i < 8; i++) raw += USER_CODE_CHARSET[randomInt(USER_CODE_CHARSET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/**
 * Normalize a human-entered user code to the canonical `XXXX-XXXX` form (upper-cased, non-`[A-Z]`
 * stripped, hyphen-regrouped). A non-8-letter input returns its cleaned form (which will never match
 * a stored canonical code).
 */
export function normalizeUserCode(raw: string): string {
  const letters = raw.toUpperCase().replace(/[^A-Z]/g, '');
  return letters.length === 8 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters;
}

/** The handler for `POST /{tenant}/oauth2/v2.0/devicecode` (endpoint A). */
function handleDeviceAuthorization(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: TokenContext,
): void {
  const cid = correlationId(request);
  const body = (request.body ?? {}) as Body;

  const auth = authenticateClient(request, ctx.store, body);
  if ('failure' in auth) {
    sendOAuthError(reply, { ...auth.failure, correlationId: cid });
    return;
  }
  const app = auth.app;

  const scopeRaw = field(body, 'scope');
  const scopes = scopeRaw ? splitScopes(scopeRaw) : [];
  if (scopes.length === 0) {
    sendOAuthError(reply, {
      error: 'invalid_scope',
      description: 'At least one scope is required for the device authorization request.',
      correlationId: cid,
    });
    return;
  }
  if (!scopesAreValid(scopes, ctx.store, ctx.config)) {
    sendOAuthError(reply, {
      error: 'invalid_scope',
      description: 'One or more requested scopes are not registered or allowed.',
      correlationId: cid,
    });
    return;
  }

  const deviceCode = generateOpaqueToken();
  const hash = sha256(deviceCode);

  let userCode = generateUserCode();
  for (
    let attempt = 0;
    ctx.store.deviceCodes.userCodeExists(userCode) && attempt < USER_CODE_MAX_ATTEMPTS;
    attempt++
  ) {
    userCode = generateUserCode();
  }

  const now = nowSeconds();
  const expiresIn = ctx.config.tokenLifetimes.deviceCode;
  const interval = ctx.config.deviceCodeInterval;
  ctx.store.deviceCodes.insert({
    deviceCode: hash,
    userCode,
    appId: app.appId,
    scopes: scopes.join(' '),
    interval,
    expiresAt: now + expiresIn,
  });

  // The verification URI echoes whichever tenant alias the device authority used, so the human
  // reaches the approval page under the same alias.
  const tenant = (request.params as { tenant?: string }).tenant ?? ctx.config.tenantId;
  const verificationUri = `${ctx.config.origins.login}/${tenant}/${TENANT_ENDPOINTS.devicecode}`;
  const verificationUriComplete = `${verificationUri}?user_code=${encodeURIComponent(userCode)}`;

  void reply
    .code(200)
    .header('cache-control', 'no-store')
    .type('application/json')
    .send({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: verificationUriComplete,
      expires_in: expiresIn,
      interval,
      message: `To sign in, open ${verificationUri} in a browser and enter the code ${userCode} to authenticate.`,
    });
}

/**
 * The `device_code` grant handler (RFC 8628 §3.5 polling), plugged into `/token`'s dispatch table.
 * Extra/telemetry poll params (including a stray `scope`) are ignored: the granted scopes come
 * solely from the stored device-code row.
 */
export async function handleDeviceCodeGrant(
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

  const deviceCode = field(body, 'device_code');
  if (!deviceCode) {
    sendOAuthError(reply, {
      error: 'invalid_request',
      description: 'Missing required parameter: device_code.',
      correlationId: cid,
    });
    return;
  }

  const hash = sha256(deviceCode);
  const now = nowSeconds();
  const row = ctx.store.deviceCodes.getByDeviceCodeHash(hash);

  if (!row) {
    sendOAuthError(reply, {
      error: 'invalid_grant',
      description: 'The device_code is invalid, expired, or already redeemed.',
      correlationId: cid,
    });
    return;
  }

  // The device code must be bound to the authenticated client.
  if (row.appId !== app.appId) {
    sendOAuthError(reply, {
      error: 'invalid_grant',
      description: 'The device_code was not issued to this client.',
      correlationId: cid,
    });
    return;
  }

  // Lazy expiry: an expired row (any status) is deleted and reported as `expired_token`.
  if (row.expiresAt <= now) {
    ctx.store.deviceCodes.consume(hash);
    sendOAuthError(reply, {
      error: 'expired_token',
      description: 'The device_code has expired. Restart the device authorization flow.',
      correlationId: cid,
    });
    return;
  }

  if (row.status === 'denied') {
    ctx.store.deviceCodes.consume(hash);
    sendOAuthError(reply, {
      error: 'access_denied',
      description: 'The user denied the device authorization request.',
      correlationId: cid,
    });
    return;
  }

  if (row.status === 'pending') {
    sendOAuthError(reply, {
      error: 'authorization_pending',
      description: 'Authorization is pending. The user has not yet approved the request.',
      correlationId: cid,
    });
    return;
  }

  if (row.status === 'approved') {
    // Atomic single-use redemption: exactly one concurrent poll observes the row.
    const redeemed = ctx.store.deviceCodes.consumeApproved(hash, app.appId, now);
    if (!redeemed) {
      sendOAuthError(reply, {
        error: 'invalid_grant',
        description: 'The device_code is invalid, expired, or already redeemed.',
        correlationId: cid,
      });
      return;
    }

    const user = redeemed.userId ? ctx.store.users.getById(redeemed.userId) : undefined;
    if (!user || !user.accountEnabled) {
      sendOAuthError(reply, {
        error: 'invalid_grant',
        description: 'The user who approved this request no longer exists or is disabled.',
        correlationId: cid,
      });
      return;
    }

    const scopes = redeemed.scopes.length > 0 ? splitScopes(redeemed.scopes) : [];
    const resource = resolveResource(scopes);
    const tokenResponse = await ctx.tokenService.buildTokenResponse({
      app,
      user,
      scopes,
      resource,
      nonce: null,
      grant: 'device_code',
    });

    // Preserve the granted (possibly resource-qualified) scopes in the response envelope (#6 parity).
    if (scopes.length > 0) {
      tokenResponse.scope = scopes.join(' ');
    }

    void reply
      .code(200)
      .header('cache-control', 'no-store')
      .header('pragma', 'no-cache')
      .type('application/json')
      .send(tokenResponse);
    return;
  }

  // Any other status (e.g. a stale `expired`) is treated as unredeemable.
  sendOAuthError(reply, {
    error: 'invalid_grant',
    description: 'The device_code is invalid, expired, or already redeemed.',
    correlationId: cid,
  });
}

/**
 * Register the device-code routes (replacing the reserved `501` stub): the RFC 8628 device
 * authorization endpoint (`POST /devicecode`, JSON) plus the human approval surface (`GET /devicecode`
 * + `POST /devicecode/verify`, HTML) owned by `deviceApproval.ts`.
 */
export function registerDeviceCodeRoutes(app: FastifyInstance): void {
  const ctx: TokenContext = {
    store: app.store,
    config: app.config,
    tokenService: app.tokenService,
  };

  app.post(
    tenantRoute(TENANT_ENDPOINTS.devicecode),
    { preHandler: tenantGuard('oauth') },
    (request: FastifyRequest, reply: FastifyReply): void => {
      handleDeviceAuthorization(request, reply, ctx);
    },
  );

  registerDeviceApprovalRoutes(app);
}
