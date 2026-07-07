import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config/schema.js';
import { sendJsonNotFound } from './errors.js';
import { TENANT_API_SEGMENTS } from './pathmap.js';

/**
 * Host-based subdomain routing for the one shared `:8443` listener (#26).
 *
 * Each advertised origin (`login.`/`portal.`/`graph.<baseDomain>`) serves only its slice of the
 * path map; the legacy `localhost`/`127.0.0.1` **compat** host serves everything (so the Docker
 * healthcheck, existing tests, samples, and the real-MSAL e2e suite stay green). When the three
 * origins collapse to one host (`PUBLIC_ORIGIN`, or the test harness) there is no separation and
 * every request is treated as `compat`.
 *
 * The Graph surface is registered under `/graph/*`, but a dedicated Graph host serves it at the
 * root (`/v1.0/*`, `/oidc/userinfo`) to mirror real `graph.microsoft.com`. {@link HostRouter.rewriteUrl}
 * re-adds the `/graph` prefix before routing so the registered handlers still match.
 */
export type HostRole = 'login' | 'portal' | 'graph' | 'compat';

export interface HostRouter {
  /** Classify a request's `Host` header into the surface it is allowed to serve. */
  role(hostHeader: string | undefined): HostRole;
  /** Pre-routing URL rewrite: prefix `/graph` to root Graph paths on the Graph host. */
  rewriteUrl(url: string, hostHeader: string | undefined): string;
}

/** Strip the query string from a raw request URL. */
function pathOnly(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/** Lower-cased hostname (port stripped, IPv6 brackets removed) from a `Host` header. */
function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? h.slice(1) : h.slice(1, end);
  }
  const colon = h.indexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

/** Parse the hostname out of a configured origin URL (empty string if it cannot be parsed). */
function originHostname(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** A request path that the Graph host exposes at its root (mapped onto the `/graph/*` routes). */
function isGraphRootPath(path: string): boolean {
  return (
    path === '/v1.0' || path.startsWith('/v1.0/') || path === '/oidc' || path.startsWith('/oidc/')
  );
}

/** STS / login slice: the tenanted OIDC routes `/{tenant}/<oauth2|discovery|v2.0|openid>/...`. */
function isLoginPath(path: string): boolean {
  const segments = path.split('/').filter((s) => s.length > 0);
  return segments.length >= 2 && (TENANT_API_SEGMENTS as readonly string[]).includes(segments[1]!);
}

/** Graph slice (registered form): `/graph` and everything beneath it. */
function isGraphPath(path: string): boolean {
  return path === '/graph' || path.startsWith('/graph/');
}

/**
 * The read-only OIDC discovery document (`/{tenant}/v2.0/.well-known/openid-configuration`). It is a
 * login-slice path, but the **portal host serves it too** so the admin SPA can load discovery
 * same-origin: a cross-origin fetch to the login host would fail unless that host's self-signed cert
 * is separately trusted (browsers can't prompt for a cert on a background `fetch`). The document
 * still advertises the login-origin endpoints, so clients are unaffected.
 */
function isDiscoveryPath(path: string): boolean {
  return /^\/[^/]+\/v2\.0\/\.well-known\/openid-configuration$/.test(path);
}

/** Portal-API slice: the admin REST API + the health probe. */
function isPortalApiPath(path: string): boolean {
  if (path === '/health') return true;
  return path === '/admin' || path.startsWith('/admin/');
}

/**
 * Build a {@link HostRouter} for a config. Origin hostnames are parsed once; per-request work is a
 * couple of string comparisons.
 */
export function createHostRouter(config: Config): HostRouter {
  const login = originHostname(config.origins.login);
  const portal = originHostname(config.origins.portal);
  const graph = originHostname(config.origins.graph);
  const collapsed = login === portal && portal === graph;

  function role(hostHeader: string | undefined): HostRole {
    if (collapsed) return 'compat';
    const host = hostnameOf(hostHeader);
    if (host === login) return 'login';
    if (host === graph) return 'graph';
    if (host === portal) return 'portal';
    return 'compat';
  }

  function rewriteUrl(url: string, hostHeader: string | undefined): string {
    if (role(hostHeader) !== 'graph') return url;
    const path = pathOnly(url);
    if (isGraphPath(path)) return url;
    if (isGraphRootPath(path)) return `/graph${url}`;
    return url;
  }

  return { role, rewriteUrl };
}

/** Convenience wrapper for tests / one-off classification. */
export function hostRole(hostHeader: string | undefined, config: Config): HostRole {
  return createHostRouter(config).role(hostHeader);
}

/** A tiny JSON descriptor returned at the root of the `login.`/`graph.` hosts. */
function sendHostDescriptor(reply: FastifyReply, role: 'login' | 'graph', config: Config): void {
  const body =
    role === 'login'
      ? {
          service: 'entra-local',
          surface: 'login',
          issuer: config.issuer,
          discovery: `${config.origins.login}/${config.tenantId}/v2.0/.well-known/openid-configuration`,
        }
      : {
          service: 'entra-local',
          surface: 'graph',
          graph: `${config.origins.graph}/v1.0`,
          userinfo: `${config.origins.graph}/oidc/userinfo`,
        };
  void reply.code(200).type('application/json').send(body);
}

/**
 * Register the `onRequest` guard that confines each typed host to its slice. The `compat` host is
 * unrestricted (legacy single-origin behavior). A cross-slice path returns a JSON 404; the bare
 * root of `login.`/`graph.` returns a small JSON descriptor instead.
 *
 * Runs after {@link HostRouter.rewriteUrl} (a pre-routing Fastify `rewriteUrl`), so Graph root
 * paths already carry their `/graph` prefix here.
 */
export function enforceHostRouting(app: FastifyInstance, router: HostRouter, config: Config): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const role = router.role(request.headers.host);
    if (role === 'compat') return;

    const path = pathOnly(request.url);
    const allowed =
      role === 'login'
        ? isLoginPath(path)
        : role === 'graph'
          ? isGraphPath(path)
          : // portal: its API/health, plus any non-reserved GET → the SPA shell.
            isPortalApiPath(path) ||
            isDiscoveryPath(path) ||
            (request.method === 'GET' && !isLoginPath(path) && !isGraphPath(path));

    if (allowed) return;

    if (path === '/' && (role === 'login' || role === 'graph')) {
      sendHostDescriptor(reply, role, config);
      return reply;
    }
    sendJsonNotFound(request, reply);
    return reply;
  });
}
