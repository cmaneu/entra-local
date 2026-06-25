import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';

let ctx: TestApp;

afterEach(async () => {
  await ctx?.close();
});

describe('GET /health (criterion 7)', () => {
  it('returns 200 with the documented JSON shape', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const body = res.json() as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(body.tls).toBe(false); // test config disables TLS
    expect(body.tenantId).toBe(TEST_TENANT_ID);
    // #26: advertised origins are reported (collapsed onto the compat origin in the test config).
    expect(body.origins).toEqual({
      login: ctx.config.origins.login,
      portal: ctx.config.origins.portal,
      graph: ctx.config.origins.graph,
    });
  });

  it('reflects the configured tenant and tls flag', async () => {
    ctx = await buildTestApp({ tls: { enabled: true, certDir: './data/tls' } });
    const res = await ctx.inject({ method: 'GET', url: '/health' });
    const body = res.json() as Record<string, unknown>;
    expect(body.tls).toBe(true);
    expect(body.tenantId).toBe(TEST_TENANT_ID);
  });
});
