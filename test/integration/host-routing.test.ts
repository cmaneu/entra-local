import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';

let ctx: TestApp;

afterEach(async () => {
  await ctx?.close();
});

const ORIGINS = {
  login: 'https://login.entra.localhost:8443',
  portal: 'https://portal.entra.localhost:8443',
  graph: 'https://graph.entra.localhost:8443',
} as const;

const HOSTS = {
  login: 'login.entra.localhost:8443',
  portal: 'portal.entra.localhost:8443',
  graph: 'graph.entra.localhost:8443',
  compat: 'localhost:8443',
} as const;

const DISCOVERY = `/${TEST_TENANT_ID}/v2.0/.well-known/openid-configuration`;

/** Build a non-collapsed app (three distinct subdomain origins → host routing active). */
async function buildHostRoutedApp(): Promise<TestApp> {
  return buildTestApp({
    origins: { ...ORIGINS },
    issuer: `${ORIGINS.login}/${TEST_TENANT_ID}/v2.0`,
  });
}

/**
 * Host-header routing (#26): with three distinct subdomain origins, each typed host serves only its
 * slice while the loopback `compat` host still serves everything. Exercised via injected `Host`
 * headers (no DNS/hosts entries needed).
 */
describe('Host routing: login. host', () => {
  it('serves discovery (200)', async () => {
    ctx = await buildHostRoutedApp();
    const res = await ctx.inject({ method: 'GET', url: DISCOVERY, headers: { host: HOSTS.login } });
    expect(res.statusCode).toBe(200);
  });

  it('404s the portal /health probe (cross-slice)', async () => {
    ctx = await buildHostRoutedApp();
    const res = await ctx.inject({ method: 'GET', url: '/health', headers: { host: HOSTS.login } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('returns a JSON login descriptor at /', async () => {
    ctx = await buildHostRoutedApp();
    const res = await ctx.inject({ method: 'GET', url: '/', headers: { host: HOSTS.login } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json() as { surface: string };
    expect(body.surface).toBe('login');
  });
});

describe('Host routing: graph. host', () => {
  it('serves Graph at the root (/v1.0/me reaches the handler → 401, not 404)', async () => {
    ctx = await buildHostRoutedApp();
    const res = await ctx.inject({
      method: 'GET',
      url: '/v1.0/me',
      headers: { host: HOSTS.graph },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('InvalidAuthenticationToken');
  });

  it('404s the portal /health probe (cross-slice)', async () => {
    ctx = await buildHostRoutedApp();
    const res = await ctx.inject({ method: 'GET', url: '/health', headers: { host: HOSTS.graph } });
    expect(res.statusCode).toBe(404);
  });

  it('returns a JSON graph descriptor at /', async () => {
    ctx = await buildHostRoutedApp();
    const res = await ctx.inject({ method: 'GET', url: '/', headers: { host: HOSTS.graph } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { surface: string };
    expect(body.surface).toBe('graph');
  });
});

describe('Host routing: portal. host', () => {
  it('serves /health (200)', async () => {
    ctx = await buildHostRoutedApp();
    const res = await ctx.inject({
      method: 'GET',
      url: '/health',
      headers: { host: HOSTS.portal },
    });
    expect(res.statusCode).toBe(200);
  });

  it('serves the SPA shell at /', async () => {
    ctx = await buildHostRoutedApp();
    const res = await ctx.inject({ method: 'GET', url: '/', headers: { host: HOSTS.portal } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('404s a login discovery path (cross-slice)', async () => {
    ctx = await buildHostRoutedApp();
    const res = await ctx.inject({
      method: 'GET',
      url: DISCOVERY,
      headers: { host: HOSTS.portal },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('Host routing: compat (loopback) host serves every slice', () => {
  it('serves discovery, /health, and Graph (under /graph)', async () => {
    ctx = await buildHostRoutedApp();
    const discovery = await ctx.inject({
      method: 'GET',
      url: DISCOVERY,
      headers: { host: HOSTS.compat },
    });
    expect(discovery.statusCode).toBe(200);

    const health = await ctx.inject({
      method: 'GET',
      url: '/health',
      headers: { host: HOSTS.compat },
    });
    expect(health.statusCode).toBe(200);

    const graph = await ctx.inject({
      method: 'GET',
      url: '/graph/v1.0/me',
      headers: { host: HOSTS.compat },
    });
    expect(graph.statusCode).toBe(401);
  });
});
