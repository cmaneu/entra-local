import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';

let ctx: TestApp;

afterEach(async () => {
  await ctx?.close();
});

/** Every reserved canonical path that is still a `501` stub (only `/devicecode` (#15) remains). */
function reservedPaths(): { method: 'GET' | 'POST'; url: string }[] {
  const t = TEST_TENANT_ID;
  return [{ method: 'POST', url: `/${t}/oauth2/v2.0/devicecode` }];
}

describe('Path map: reserved-stub rule (criterion 8)', () => {
  it('every remaining reserved OIDC/OAuth path returns 501 (not 404/SPA)', async () => {
    ctx = await buildTestApp();
    for (const { method, url } of reservedPaths()) {
      const res = await ctx.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(501);
      expect(res.headers['content-type'], `${method} ${url}`).toContain('application/json');
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe('not_implemented');
    }
  });

  it('discovery routing reaches the real handler for the GUID and aliases', async () => {
    ctx = await buildTestApp();
    for (const tenant of [TEST_TENANT_ID, 'common', 'organizations', 'consumers']) {
      const res = await ctx.inject({
        method: 'GET',
        url: `/${tenant}/v2.0/.well-known/openid-configuration`,
      });
      // #4 replaced the reserved 501 stub with the real discovery handler.
      expect(res.statusCode, tenant).toBe(200);
    }
  });

  it('graph /v1.0/* paths reach the real #10 handlers (401 without bearer, not 501)', async () => {
    ctx = await buildTestApp();
    const graphPaths = [
      '/graph/v1.0/me',
      '/graph/v1.0/users',
      '/graph/v1.0/users/abc',
      '/graph/v1.0/groups',
      '/graph/v1.0/groups/abc',
      '/graph/v1.0/groups/abc/members',
    ];
    for (const url of graphPaths) {
      const res = await ctx.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
      expect(res.headers['content-type'], url).toContain('application/json');
      const body = res.json() as { error: { code: string } };
      expect(body.error.code, url).toBe('InvalidAuthenticationToken');
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
