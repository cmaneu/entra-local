import type { FastifyRequest } from 'fastify';
import type { Store } from '../store/store.js';
import type { AppRegistration } from '../store/types.js';

/**
 * Shared client-authentication for the token-family endpoints (`/token` grants and the device
 * authorization endpoint). Extracted verbatim from feature #6's `token.ts` so every grant — and the
 * RFC 8628 device-authorization endpoint (#15) — single-sources the same rules: `client_secret_basic`
 * (Authorization header) takes precedence over `client_secret_post` (body); confidential clients
 * must present a valid secret; public clients must NOT present one (possession is their proof). A
 * failure surfaces as a canonical `invalid_client`.
 */

/** A parsed form/body record. */
export type Body = Record<string, unknown>;

/** Read a single string field from a parsed form body (first value wins for arrays). */
export function field(body: Body, key: string): string | undefined {
  const v = body[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
}

/** Parse `Authorization: Basic base64(client_id:client_secret)` (client_secret_basic). */
export function parseBasicAuth(
  header: string | undefined,
): { id: string; secret: string } | undefined {
  if (!header || !header.toLowerCase().startsWith('basic ')) return undefined;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  } catch {
    return undefined;
  }
  const idx = decoded.indexOf(':');
  if (idx === -1) return undefined;
  const decode = (s: string): string => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  return { id: decode(decoded.slice(0, idx)), secret: decode(decoded.slice(idx + 1)) };
}

/** A client-auth failure: the canonical OAuth error to surface (correlation id added by caller). */
export interface ClientAuthFailure {
  error: 'invalid_client';
  description: string;
}

/**
 * Authenticate the client on a token-family endpoint (shared by every grant + the device
 * authorization endpoint). `client_secret_basic` (Authorization header) takes precedence over
 * `client_secret_post` (body). Confidential clients must present a valid `client_secret`; public
 * clients must NOT present one (possession of the code/refresh/device token is their proof). Returns
 * the resolved app or a canonical `invalid_client`.
 */
export function authenticateClient(
  request: FastifyRequest,
  store: Store,
  body: Body,
): { app: AppRegistration } | { failure: ClientAuthFailure } {
  const basic = parseBasicAuth(request.headers.authorization);
  const clientId = basic?.id ?? field(body, 'client_id');
  const clientSecret = basic?.secret ?? field(body, 'client_secret');

  if (!clientId) {
    return {
      failure: {
        error: 'invalid_client',
        description: 'A client_id is required to authenticate the token request.',
      },
    };
  }
  const app = store.apps.getByAppId(clientId);
  if (!app) {
    return {
      failure: {
        error: 'invalid_client',
        description: `No application is registered with client_id '${clientId}'.`,
      },
    };
  }
  if (app.isConfidential) {
    if (!clientSecret) {
      return {
        failure: {
          error: 'invalid_client',
          description: 'This confidential client requires a client_secret.',
        },
      };
    }
    if (!store.apps.verifySecret(app.appId, clientSecret)) {
      return {
        failure: { error: 'invalid_client', description: 'The provided client_secret is invalid.' },
      };
    }
  } else if (clientSecret) {
    return {
      failure: {
        error: 'invalid_client',
        description: 'A public client must not present a client_secret.',
      },
    };
  }
  return { app };
}
