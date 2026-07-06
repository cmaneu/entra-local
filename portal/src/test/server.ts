import { vi } from 'vitest';
import type { CertificateInfo, Discovery, Health } from '../api/types';

/** Deterministic emulator identity used across portal component tests (mirrors the seed). */
export const TENANT_ID = '11111111-1111-1111-1111-111111111111';
export const ORIGIN = 'https://localhost:8443';

export const HEALTH: Health = {
  status: 'ok',
  version: '0.1.0',
  uptimeSeconds: 42,
  tls: true,
  tenantId: TENANT_ID,
  origins: { login: ORIGIN, portal: ORIGIN, graph: ORIGIN },
};

export const DISCOVERY: Discovery = {
  issuer: `${ORIGIN}/${TENANT_ID}/v2.0`,
  authorization_endpoint: `${ORIGIN}/${TENANT_ID}/oauth2/v2.0/authorize`,
  token_endpoint: `${ORIGIN}/${TENANT_ID}/oauth2/v2.0/token`,
  jwks_uri: `${ORIGIN}/${TENANT_ID}/discovery/v2.0/keys`,
  userinfo_endpoint: `${ORIGIN}/oidc/userinfo`,
  end_session_endpoint: `${ORIGIN}/${TENANT_ID}/oauth2/v2.0/logout`,
};

export const CERTIFICATE: CertificateInfo = {
  enabled: true,
  subject: 'CN=localhost\nOU=Entra Local emulator\nO=Entra Local',
  issuer: 'CN=localhost\nOU=Entra Local emulator\nO=Entra Local',
  fingerprintSha256: 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89',
  thumbprintSha1: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
  serialNumber: '01',
  validFrom: 'Jan  1 00:00:00 2026 GMT',
  validTo: 'Jan  1 00:00:00 2036 GMT',
  fileName: 'entra-local-ca.crt',
  downloadPath: '/admin/api/certificate/pem',
};

export interface RequestContext {
  method: string;
  path: string;
  body: unknown;
}

export interface RouteResult {
  status?: number;
  body?: unknown;
}

/** A test handler: return a {@link RouteResult} to handle a request, or `undefined` to fall through. */
export type Handler = (ctx: RequestContext) => RouteResult | undefined;

/**
 * Replace `globalThis.fetch` with a deterministic fake routed through `handler`. Unhandled requests
 * fall back to the standard `/health` + discovery responses (so the shell always loads), else 404.
 */
export function installFetch(handler: Handler = () => undefined): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const body =
      typeof init?.body === 'string' && init.body.length > 0 ? JSON.parse(init.body) : undefined;

    let res = handler({ method, path, body });
    if (!res) {
      if (path === '/health') res = { body: HEALTH };
      else if (path.includes('/.well-known/openid-configuration')) res = { body: DISCOVERY };
      else if (path === '/admin/api/certificate') res = { body: CERTIFICATE };
      else res = { status: 404, body: { error: { code: 'not_found', message: 'Not found.' } } };
    }

    const status = res.status ?? 200;
    const text = res.body === undefined ? '' : JSON.stringify(res.body);
    return new Response(status === 204 ? '' : text, {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** Build a paginated Admin API envelope. */
export function paged<T>(value: T[], top = 50, skip = 0): RouteResult {
  return { body: { value, count: value.length, top, skip } };
}
