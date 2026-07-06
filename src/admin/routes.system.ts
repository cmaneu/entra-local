import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readCertificateInfo } from '../tls/cert.js';
import { appVersion } from '../version.js';
import { notFound } from './errors.js';
import { resetSchema, seedSchema } from './schemas.js';

/** Filename browsers/clients save the downloaded dev cert as. */
const CERT_FILE_NAME = 'entra-local-ca.crt';

/** Register `/admin/api/{seed,reset,health,certificate}` routes on the admin (sub-)instance. */
export function registerSystemRoutes(app: FastifyInstance): void {
  const { store, config } = app;

  app.post('/api/seed', (request: FastifyRequest) => {
    const { force } = seedSchema.parse(request.body ?? {});
    const hasTenant = store.tenants.getDefault() !== undefined;
    if (!force && hasTenant) {
      return { seeded: false };
    }
    store.seed(); // idempotent skip-existing (INSERT OR IGNORE); never deletes
    return { seeded: true };
  });

  app.post('/api/reset', (request: FastifyRequest) => {
    const { reseed, resetKeys } = resetSchema.parse(request.body ?? {});
    store.reset({ reseed, resetKeys });
    return { reset: true, reseeded: reseed };
  });

  app.get('/api/health', () => {
    return {
      status: 'ok' as const,
      version: appVersion(),
      uptimeSeconds: Math.floor(process.uptime()),
      tls: config.tls.enabled,
      tenantId: config.tenantId,
    };
  });

  // Public metadata about the self-signed dev cert clients must trust. The certificate is public
  // (never the private key), so exposing it lets the portal offer a download + per-platform trust
  // instructions — useful for the Docker target, which has no host CLI.
  app.get('/api/certificate', () => {
    const info = readCertificateInfo(config);
    if (!info) {
      return { enabled: false as const };
    }
    return {
      enabled: true as const,
      subject: info.subject,
      issuer: info.issuer,
      fingerprintSha256: info.fingerprintSha256,
      thumbprintSha1: info.thumbprintSha1,
      serialNumber: info.serialNumber,
      validFrom: info.validFrom,
      validTo: info.validTo,
      fileName: CERT_FILE_NAME,
      downloadPath: '/admin/api/certificate/pem',
    };
  });

  // Download the (public) certificate PEM as an attachment.
  app.get('/api/certificate/pem', (_request: FastifyRequest, reply: FastifyReply) => {
    const info = readCertificateInfo(config);
    if (!info) {
      throw notFound('TLS is disabled (TLS_ENABLED=false) — there is no certificate to trust.');
    }
    void reply
      .header('content-type', 'application/x-pem-file; charset=utf-8')
      .header('content-disposition', `attachment; filename="${CERT_FILE_NAME}"`);
    return info.pem;
  });
}
