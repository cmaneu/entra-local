import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';

let ctx: TestApp;

afterEach(async () => {
  await ctx?.close();
});

/** Every reserved canonical path, with the tenant GUID substituted. */
function reservedPaths(): { method: 'GET' | 'POST'; url: string }[] {
  const t = TEST_TENANT_ID;
  return [
    { method: 'GET', url: `/${t}/v2.0/.well-known/openid-configuration` },
    { method: 'GET', url: `/${t}/discovery/v2.0/keys` },
    { method: 'GET', url: `/${t}/oauth2/v2.0/authorize` },
    { method: 'POST', url: `/${t}/oauth2/v2.0/token` },
    { method: 'GET', url: `/${t}/oauth2/v2.0/logout` },
    { method: 'POST', url: `/${t}/oauth2/v2.0/devicecode` },
    { method: 'GET', url: '/graph/v1.0/me' },
    { method: 'GET', url: '/graph/v1.0/users' },
    { method: 'GET', url: '/graph/v1.0/users/abc' },
    { method: 'GET', url: '/graph/v1.0/groups' },
    { method: 'GET', url: '/graph/v1.0/groups/abc' },
    { method: 'GET', url: '/graph/v1.0/groups/abc/members' },
    { method: 'GET', url: '/graph/oidc/userinfo' },
    { method: 'POST', url: '/graph/oidc/userinfo' },
  ];
}

describe('Path map: reserved-stub rule (criterion 8)', () => {
  it('every reserved OIDC/OAuth/Graph/UserInfo path returns 501 (not 404/SPA)', async () => {
    ctx = await buildTestApp();
    for (const { method, url } of reservedPaths()) {
      const res = await ctx.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(501);
      expect(res.headers['content-type'], `${method} ${url}`).toContain('application/json');
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe('not_implemented');
    }
  });

  it('discovery routing reaches the plugin mount for the GUID and aliases', async () => {
    ctx = await buildTestApp();
    for (const tenant of [TEST_TENANT_ID, 'common', 'organizations', 'consumers']) {
      const res = await ctx.inject({
        method: 'GET',
        url: `/${tenant}/v2.0/.well-known/openid-configuration`,
      });
      expect(res.statusCode, tenant).toBe(501);
    }
  });
});

describe('Path map: tenant allowlist (criterion 8)', () => {
  it('rejects an invalid tenant on an OAuth endpoint with JSON, not SPA', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({ method: 'GET', url: '/badtenant/oauth2/v2.0/authorize' });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json() as { error: string };
    expect(body.error).toBe('invalid_request');
  });

  it('rejects an invalid tenant on discovery with JSON 404, not SPA', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'GET',
      url: '/badtenant/v2.0/.well-known/openid-configuration',
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('tenant_not_found');
  });
});

describe('SPA fallback vs JSON 404 (criterion 9)', () => {
  it('GET / serves the placeholder index.html', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Entra Local');
  });

  it('GET /some/portal/route serves the placeholder index.html', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({ method: 'GET', url: '/some/portal/route' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('GET /admin/api/does-not-exist returns JSON 404, never HTML', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({ method: 'GET', url: '/admin/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('GET an unmatched /graph route returns JSON 404, never HTML', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({ method: 'GET', url: '/graph/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('GET an unmatched tenant-shaped route returns JSON 404, never HTML', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({ method: 'GET', url: '/common/oauth2/v2.0/bogus' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('non-GET to an unmatched route returns JSON 404, never SPA', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({ method: 'POST', url: '/totally/unknown' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });
});
