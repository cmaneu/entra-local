import { X509Certificate } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import selfsigned from 'selfsigned';
import type { Config } from '../config/schema.js';

export interface TlsMaterial {
  key: string;
  cert: string;
}

const CERT_FILE = 'cert.pem';
const KEY_FILE = 'key.pem';

/** SHA-256 fingerprint (e.g. `AB:CD:...`) of a PEM certificate — used to assert stability. */
export function certFingerprint(certPem: string): string {
  return new X509Certificate(certPem).fingerprint256;
}

/**
 * SHA-1 thumbprint of a PEM certificate, without separators (e.g. `ABCD…`). Used to match the cert
 * for removal from the Windows certificate store (`certutil -delstore … <thumbprint>`).
 */
export function certThumbprint(certPem: string): string {
  return new X509Certificate(certPem).fingerprint.replaceAll(':', '');
}

/**
 * Generate a self-signed certificate for local HTTPS.
 *
 * NOTE: `node:crypto` can generate keypairs but cannot create/sign an X.509 certificate, so
 * we use the spec-approved `selfsigned` fallback (see memory/decisions.md). CN=localhost with
 * SANs for localhost / 127.0.0.1 / ::1, RSA-2048, 10-year validity.
 */
function generateSelfSigned(): TlsMaterial {
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const pems = selfsigned.generate(attrs, {
    keySize: 2048,
    days: 3650,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          { type: 7, ip: '::1' },
        ],
      },
    ],
  });
  return { key: pems.private, cert: pems.cert };
}

/** Restrict private-key file perms (best-effort; chmod is largely a no-op on Windows). */
function restrictKeyPerms(keyPath: string): void {
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    // Best-effort: some filesystems / Windows do not support POSIX perms.
  }
}

/**
 * Resolve the TLS key/cert pair per the spec's TLS material flow:
 *  - `TLS_ENABLED=false` → `null` (caller serves plain HTTP).
 *  - both `TLS_CERT`/`TLS_KEY` set → load the provided PEMs.
 *  - otherwise → load a persisted self-signed cert from `TLS_CERT_DIR`, generating + persisting
 *    one (stable across restarts) on first boot.
 */
export function resolveTlsMaterial(config: Config): TlsMaterial | null {
  if (!config.tls.enabled) return null;

  if (config.tls.certPath && config.tls.keyPath) {
    return {
      cert: readFileSync(resolve(config.tls.certPath), 'utf8'),
      key: readFileSync(resolve(config.tls.keyPath), 'utf8'),
    };
  }

  const dir = resolve(config.tls.certDir);
  const certPath = join(dir, CERT_FILE);
  const keyPath = join(dir, KEY_FILE);

  if (existsSync(certPath) && existsSync(keyPath)) {
    return {
      cert: readFileSync(certPath, 'utf8'),
      key: readFileSync(keyPath, 'utf8'),
    };
  }

  const material = generateSelfSigned();
  mkdirSync(dir, { recursive: true });
  writeFileSync(certPath, material.cert, { encoding: 'utf8' });
  writeFileSync(keyPath, material.key, { encoding: 'utf8', mode: 0o600 });
  restrictKeyPerms(keyPath);
  return material;
}

/**
 * Absolute path of the certificate clients must trust, generating + persisting the auto-cert on
 * first call so the path is always valid. Throws when TLS is disabled (nothing to trust).
 *  - both `TLS_CERT`/`TLS_KEY` set → the provided cert path.
 *  - otherwise → `<TLS_CERT_DIR>/cert.pem`, generated on first call.
 */
export function resolveCertPath(config: Config): string {
  if (!config.tls.enabled) {
    throw new Error('TLS is disabled (TLS_ENABLED=false) — there is no certificate to trust.');
  }
  if (config.tls.certPath && config.tls.keyPath) {
    return resolve(config.tls.certPath);
  }
  // Ensure the auto-cert exists (generates + persists on first call).
  resolveTlsMaterial(config);
  return join(resolve(config.tls.certDir), CERT_FILE);
}
