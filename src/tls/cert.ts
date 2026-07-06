import { X509Certificate } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';
import selfsigned from 'selfsigned';
import type { Config } from '../config/schema.js';

export interface TlsMaterial {
  key: string;
  cert: string;
}

/** The DNS names and IPs a generated/loaded cert must cover. */
export interface CertSans {
  dns: string[];
  ips: string[];
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

/** Hostname of an origin URL, lower-cased (empty string when it cannot be parsed). */
function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Derive the SAN set the local cert must cover (#26): the apex base domain and its wildcard, the
 * loopback compat names (`localhost`/`127.0.0.1`/`::1`), each advertised origin's host, and every
 * `LOCAL_DOMAINS` extra (plus its `*.` wildcard). De-duplicated; DNS vs IP split for selfsigned.
 */
export function desiredSans(config: Config): CertSans {
  const dns = new Set<string>(['localhost']);
  const ips = new Set<string>(['127.0.0.1', '::1']);

  const addHost = (host: string): void => {
    const h = host.toLowerCase();
    if (!h) return;
    if (isIP(h)) ips.add(h);
    else dns.add(h);
  };

  const base = config.baseDomain.trim().toLowerCase();
  if (base) {
    dns.add(base);
    dns.add(`*.${base}`);
  }

  addHost(hostnameOf(config.origins.login));
  addHost(hostnameOf(config.origins.portal));
  addHost(hostnameOf(config.origins.graph));

  for (const extra of config.localDomains) {
    const d = extra.trim().toLowerCase();
    if (!d) continue;
    if (isIP(d)) {
      ips.add(d);
      continue;
    }
    dns.add(d);
    dns.add(`*.${d}`);
  }

  return { dns: [...dns], ips: [...ips] };
}

/** Parse a cert's SubjectAltName into lower-cased DNS and IP sets. */
function parseSans(certPem: string): { dns: Set<string>; ips: Set<string> } {
  const dns = new Set<string>();
  const ips = new Set<string>();
  const san = new X509Certificate(certPem).subjectAltName;
  if (!san) return { dns, ips };
  for (const entry of san.split(',')) {
    const trimmed = entry.trim();
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const kind = trimmed.slice(0, colon).toLowerCase();
    const value = trimmed
      .slice(colon + 1)
      .trim()
      .toLowerCase();
    if (kind === 'dns') dns.add(value);
    else if (kind.startsWith('ip')) ips.add(value);
  }
  return { dns, ips };
}

/** Whether `name` is covered by the cert's DNS set (exact, or via a single-label `*.` wildcard). */
function dnsCovered(name: string, certDns: Set<string>): boolean {
  if (certDns.has(name)) return true;
  const dot = name.indexOf('.');
  if (dot > 0 && certDns.has(`*.${name.slice(dot + 1)}`)) return true;
  return false;
}

/**
 * Whether a persisted cert already covers every required DNS name and IP. Wildcard-aware for DNS;
 * `::1` is normalized so `0:0:0:0:0:0:0:1` style encodings still match. A `false` result triggers
 * regeneration in {@link resolveTlsMaterial}.
 */
export function certCoversDomains(certPem: string, required: CertSans): boolean {
  let parsed: { dns: Set<string>; ips: Set<string> };
  try {
    parsed = parseSans(certPem);
  } catch {
    return false;
  }
  for (const name of required.dns) {
    if (!dnsCovered(name, parsed.dns)) return false;
  }
  for (const ip of required.ips) {
    if (parsed.ips.has(ip)) continue;
    // Tolerate fully-expanded IPv6 loopback encodings.
    if (ip === '::1' && parsed.ips.has('0:0:0:0:0:0:0:1')) continue;
    return false;
  }
  return true;
}

/**
 * Generate a self-signed certificate for local HTTPS covering `sans`.
 *
 * NOTE: `node:crypto` can generate keypairs but cannot create/sign an X.509 certificate, so we use
 * the spec-approved `selfsigned` fallback (see memory/decisions.md). CN is the apex base domain
 * (falling back to `localhost`); SANs are the wildcard `*.entra.localhost`, the apex, the loopback
 * names, and any `LOCAL_DOMAINS` extras. RSA-2048, 10-year validity.
 */
function generateSelfSigned(sans: CertSans, commonName: string): TlsMaterial {
  const attrs = [{ name: 'commonName', value: commonName }];
    const attrs = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'Entra Local' },
    { name: 'organizationalUnitName', value: 'Entra Local emulator' },
  ];
  
  const altNames = [
    ...sans.dns.map((value) => ({ type: 2, value })),
    ...sans.ips.map((ip) => ({ type: 7, ip })),
  ];

  const pems = selfsigned.generate(attrs, {
    keySize: 2048,
    days: 3650,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
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

/** Generate, persist (with restricted key perms), and return a fresh auto-cert for `config`. */
function generateAndPersist(
  config: Config,
  dir: string,
  certPath: string,
  keyPath: string,
): TlsMaterial {
  const sans = desiredSans(config);
  const commonName = config.baseDomain.trim() || 'localhost';
  const material = generateSelfSigned(sans, commonName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(certPath, material.cert, { encoding: 'utf8' });
  writeFileSync(keyPath, material.key, { encoding: 'utf8', mode: 0o600 });
  restrictKeyPerms(keyPath);
  return material;
}

/**
 * Resolve the TLS key/cert pair per the spec's TLS material flow:
 *  - `TLS_ENABLED=false` → `null` (caller serves plain HTTP).
 *  - both `TLS_CERT`/`TLS_KEY` set → load the provided PEMs (used as-is; never regenerated).
 *  - otherwise → load a persisted self-signed cert from `TLS_CERT_DIR`, generating + persisting one
 *    (stable across restarts) on first boot, or **regenerating** it when its SANs no longer cover
 *    the configured domain set (e.g. after switching on local domains).
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
    const cert = readFileSync(certPath, 'utf8');
    const key = readFileSync(keyPath, 'utf8');
    if (certCoversDomains(cert, desiredSans(config))) {
      return { cert, key };
    }
    // Persisted cert predates the configured domain set — regenerate so HTTPS matches the
    // advertised origins (otherwise clients hit a name-mismatch TLS error).
    return generateAndPersist(config, dir, certPath, keyPath);
  }

  return generateAndPersist(config, dir, certPath, keyPath);
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

/** Public metadata about the certificate clients must trust (never includes the private key). */
export interface CertificateInfo {
  /** Absolute path of the cert PEM on disk. */
  readonly path: string;
  /** The certificate in PEM form (public — safe to expose/download). */
  readonly pem: string;
  /** Distinguished name of the subject, e.g. `CN=localhost\nOU=Entra Local emulator\n…`. */
  readonly subject: string;
  /** Distinguished name of the issuer (self-signed → equals the subject). */
  readonly issuer: string;
  /** SHA-256 fingerprint (`AB:CD:…`). */
  readonly fingerprintSha256: string;
  /** SHA-1 thumbprint without separators (matches the Windows store lookup). */
  readonly thumbprintSha1: string;
  /** Certificate serial number. */
  readonly serialNumber: string;
  /** Not-before validity date (as reported by the X.509 cert). */
  readonly validFrom: string;
  /** Not-after validity date (as reported by the X.509 cert). */
  readonly validTo: string;
}

/**
 * Read the (public) certificate clients must trust, parsing its subject/fingerprint/validity.
 * Returns `null` when TLS is disabled (there is no certificate to trust). Generates + persists the
 * auto-cert on first call via {@link resolveCertPath}.
 */
export function readCertificateInfo(config: Config): CertificateInfo | null {
  if (!config.tls.enabled) return null;
  const path = resolveCertPath(config);
  const pem = readFileSync(path, 'utf8');
  const x509 = new X509Certificate(pem);
  return {
    path,
    pem,
    subject: x509.subject,
    issuer: x509.issuer,
    fingerprintSha256: x509.fingerprint256,
    thumbprintSha1: x509.fingerprint.replaceAll(':', ''),
    serialNumber: x509.serialNumber,
    validFrom: x509.validFrom,
    validTo: x509.validTo,
  };
}
