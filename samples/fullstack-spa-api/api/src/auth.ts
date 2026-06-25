import { readFileSync } from 'node:fs';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response as ExpressResponse,
} from 'express';
import {
  createRemoteJWKSet,
  customFetch,
  decodeJwt,
  decodeProtectedHeader,
  errors,
  type FetchImplementation,
  type JWTPayload,
  jwtVerify,
} from 'jose';
import { issuer, jwksUri, type ApiConfig } from './config.js';

/** Validated access-token claims the emulator emits for a delegated (user) token. */
export interface AccessTokenClaims extends JWTPayload {
  scp?: string;
  oid?: string;
  preferred_username?: string;
  azp?: string;
  appid?: string;
}

/** Express request augmented with the validated token claims. */
export interface AuthedRequest extends Request {
  claims?: AccessTokenClaims;
}

function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined;
  const token = value.trim();
  return token.length > 0 ? token : undefined;
}

/**
 * Build a `fetch` implementation that trusts the emulator's self-signed dev certificate explicitly,
 * via a Node `https.Agent` seeded with the CA. This is what lets the JWKS fetch succeed over HTTPS
 * **without** requiring `NODE_EXTRA_CA_CERTS` to be set before Node starts. Only used for the JWKS
 * fetch; it implements just the subset of `fetch` that {@link createRemoteJWKSet} relies on (a GET
 * that resolves to a WHATWG `Response`).
 */
function createCaTrustingFetch(ca: Buffer): FetchImplementation {
  const agent = new HttpsAgent({ ca });
  return (url, options) =>
    new Promise<Response>((resolve, reject) => {
      const headers: Record<string, string> = {};
      options.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const req = httpsRequest(url, { agent, method: options.method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) responseHeaders.set(key, value.join(', '));
            else if (value != null) responseHeaders.set(key, value);
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 502,
              statusText: res.statusMessage ?? '',
              headers: responseHeaders,
            }),
          );
        });
      });

      req.on('error', reject);
      if (options.signal.aborted) {
        req.destroy(new Error('The JWKS request was aborted.'));
      } else {
        options.signal.addEventListener(
          'abort',
          () => req.destroy(new Error('The JWKS request was aborted.')),
          { once: true },
        );
      }
      req.end();
    });
}

/**
 * Create the remote JWKS resolver. When the emulator dev certificate is readable, the resolver
 * fetches the JWKS through a CA-trusting fetch ({@link createCaTrustingFetch}); otherwise it falls
 * back to the default fetch, which still honours `NODE_EXTRA_CA_CERTS` if it was exported before
 * start. The chosen mode is logged once so the startup banner makes the trust path obvious.
 */
function createJwks(config: ApiConfig): ReturnType<typeof createRemoteJWKSet> {
  const url = new URL(jwksUri(config));
  let ca: Buffer | undefined;
  try {
    ca = readFileSync(config.caCertPath);
  } catch (err) {
    /* eslint-disable no-console -- sample diagnostics */
    console.warn(
      `[auth] Could not read the emulator dev certificate at "${config.caCertPath}" ` +
        `(${(err as NodeJS.ErrnoException).code ?? 'unknown error'}). Falling back to the default ` +
        'HTTPS trust store — the JWKS fetch will only succeed if NODE_EXTRA_CA_CERTS is set. ' +
        'Set EMULATOR_CA_CERT to the emulator cert.pem to fix this.',
    );
    /* eslint-enable no-console */
    return createRemoteJWKSet(url);
  }

  /* eslint-disable no-console -- sample diagnostics */
  console.log(`[auth] Trusting emulator dev certificate for the JWKS fetch: ${config.caCertPath}`);
  /* eslint-enable no-console */
  return createRemoteJWKSet(url, { [customFetch]: createCaTrustingFetch(ca) });
}

/** Decode (without verifying) the bits of a token useful for diagnostics. */
function describeToken(token: string): { kid?: string; alg?: string; claims: Partial<JWTPayload> } {
  try {
    const header = decodeProtectedHeader(token);
    const claims = decodeJwt(token);
    return {
      kid: typeof header.kid === 'string' ? header.kid : undefined,
      alg: typeof header.alg === 'string' ? header.alg : undefined,
      claims: { iss: claims.iss, aud: claims.aud, sub: claims.sub, scp: claims.scp },
    };
  } catch {
    return { claims: {} };
  }
}

/**
 * Build the JWT-validation middleware.
 *
 * It verifies the Bearer token against the emulator JWKS (RS256, by `kid`), and asserts:
 *   - `iss` equals the concrete-GUID issuer from discovery (`<origin>/<tenant>/v2.0`);
 *   - `aud` equals THIS API app registration (`API_APP_ID`);
 *   - `scp` contains the required delegated scope (`REQUIRED_SCOPE`).
 *
 * Responses follow RFC 6750: `401` for a missing/invalid/expired token, `403` for a valid token
 * that lacks the required scope. Every rejection is logged with the underlying cause so a JWKS
 * fetch / TLS failure is never silently collapsed into a generic message.
 */
export function createAuthMiddleware(config: ApiConfig): RequestHandler {
  // `createRemoteJWKSet` caches keys and refetches on unknown `kid`, so it is created once.
  const jwks = createJwks(config);
  const expectedIssuer = issuer(config);

  return async (req: AuthedRequest, res: ExpressResponse, next: NextFunction): Promise<void> => {
    const token = extractBearer(req.headers.authorization);
    if (!token) {
      res
        .status(401)
        .json({ error: 'invalid_token', error_description: 'Missing or malformed Bearer token.' });
      return;
    }

    let payload: AccessTokenClaims;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer: expectedIssuer,
        audience: config.apiAppId,
      }));
    } catch (err) {
      const tokenInfo = describeToken(token);
      if (err instanceof errors.JOSEError) {
        /* eslint-disable-next-line no-console -- sample diagnostics */
        console.warn(
          `[auth] Token rejected (${err.code}): ${err.message}. ` +
            `expected iss=${expectedIssuer} aud=${config.apiAppId}; ` +
            `token iss=${String(tokenInfo.claims.iss)} aud=${String(tokenInfo.claims.aud)} ` +
            `kid=${String(tokenInfo.kid)} alg=${String(tokenInfo.alg)}`,
        );
        res.status(401).json({ error: 'invalid_token', error_description: err.message });
        return;
      }
      // A non-JOSE error here is almost always the JWKS fetch failing (e.g. the emulator's
      // self-signed certificate is not trusted, or the emulator is unreachable). Surface it.
      /* eslint-disable-next-line no-console -- sample diagnostics */
      console.error(
        `[auth] JWKS fetch / validation error (non-JOSE) while fetching ${jwksUri(config)} — ` +
          'check the API can reach the emulator over HTTPS with a trusted certificate:',
        err,
      );
      res.status(401).json({
        error: 'invalid_token',
        error_description:
          'Access token validation failed: could not fetch or use the emulator signing keys ' +
          '(JWKS). The API likely cannot reach the emulator over HTTPS with a trusted ' +
          'certificate. See the API logs and this sample\u2019s README (certificate trust).',
      });
      return;
    }

    const scopes = typeof payload.scp === 'string' ? payload.scp.split(' ') : [];
    if (!scopes.includes(config.requiredScope)) {
      /* eslint-disable-next-line no-console -- sample diagnostics */
      console.warn(
        `[auth] Token missing required scope '${config.requiredScope}' (had '${payload.scp ?? ''}').`,
      );
      res.status(403).json({
        error: 'insufficient_scope',
        error_description: `Token is missing the required scope '${config.requiredScope}'.`,
      });
      return;
    }

    /* eslint-disable-next-line no-console -- sample diagnostics */
    console.log(
      `[auth] Token OK: aud=${String(payload.aud)} scp=${String(payload.scp)} ` +
        `azp=${String(payload.azp ?? payload.appid)} oid=${String(payload.oid)}`,
    );
    req.claims = payload;
    next();
  };
}

/**
 * One-shot JWKS reachability probe for the startup banner. Uses the same CA-trusting fetch as the
 * middleware so a TLS / connectivity problem is reported the moment the API boots, instead of only
 * on the first protected request.
 */
export async function probeJwks(
  config: ApiConfig,
): Promise<{ ok: boolean; keyCount?: number; error?: unknown }> {
  const url = jwksUri(config);
  let ca: Buffer | undefined;
  try {
    ca = readFileSync(config.caCertPath);
  } catch {
    ca = undefined;
  }
  try {
    const res = ca
      ? await createCaTrustingFetch(ca)(url, {
          headers: new Headers(),
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(5000),
        })
      : await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return { ok: false, error: new Error(`JWKS endpoint returned HTTP ${res.status}.`) };
    }
    const body = (await res.json()) as { keys?: unknown[] };
    return { ok: true, keyCount: Array.isArray(body.keys) ? body.keys.length : 0 };
  } catch (err) {
    return { ok: false, error: err };
  }
}
