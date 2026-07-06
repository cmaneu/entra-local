import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { TMP_DIR } from '../helpers/constants.js';

/**
 * Integration tests for the certificate-trust endpoints (`/admin/api/certificate[/pem]`) added so
 * the portal can offer a download + per-platform trust instructions (notably for the Docker target,
 * which has no host CLI). Each TLS-enabled case uses a fresh ephemeral cert dir so a brand-new cert
 * is generated (asserting the "Entra Local emulator" subject on freshly-minted certs).
 */

let ctx: TestApp;
const certDirs: string[] = [];

afterEach(async () => {
  await ctx?.close();
  for (const dir of certDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Build a TLS-enabled app with a unique, disposable cert dir (cleaned up after the run). */
async function buildTlsApp(): Promise<TestApp> {
  const certDir = join(TMP_DIR, `tls-${randomUUID()}`);
  certDirs.push(certDir);
  return buildTestApp({ tls: { enabled: true, certDir } });
}

describe('GET /admin/api/certificate', () => {
  it('returns cert metadata whose subject identifies the Entra Local emulator', async () => {
    ctx = await buildTlsApp();
    const res = await ctx.inject({ method: 'GET', url: '/admin/api/certificate' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.enabled).toBe(true);
    expect(String(body.subject)).toContain('Entra Local emulator');
    expect(String(body.subject)).toContain('localhost');
    expect(body.fingerprintSha256).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2})+$/);
    expect(String(body.thumbprintSha1)).toMatch(/^[0-9A-F]+$/);
    expect(typeof body.validFrom).toBe('string');
    expect(typeof body.validTo).toBe('string');
    expect(body.fileName).toBe('entra-local-ca.crt');
    expect(body.downloadPath).toBe('/admin/api/certificate/pem');
  });

  it('reports enabled:false when TLS is disabled (test default)', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({ method: 'GET', url: '/admin/api/certificate' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false });
  });
});

describe('GET /admin/api/certificate/pem', () => {
  it('serves the PEM as a downloadable attachment', async () => {
    ctx = await buildTlsApp();
    const res = await ctx.inject({ method: 'GET', url: '/admin/api/certificate/pem' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-pem-file');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('entra-local-ca.crt');
    expect(res.body).toContain('-----BEGIN CERTIFICATE-----');
    expect(res.body).toContain('-----END CERTIFICATE-----');
  });

  it('returns a 404 admin error when TLS is disabled', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({ method: 'GET', url: '/admin/api/certificate/pem' });

    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toContain('TLS is disabled');
  });
});
