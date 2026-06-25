import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Config } from '../../src/config/schema.js';
import {
  certCoversDomains,
  certFingerprint,
  desiredSans,
  resolveTlsMaterial,
} from '../../src/tls/cert.js';
import { makeTestConfig, TMP_DIR } from '../helpers/constants.js';

const SUB_ORIGINS = {
  login: 'https://login.entra.localhost:8443',
  portal: 'https://portal.entra.localhost:8443',
  graph: 'https://graph.entra.localhost:8443',
} as const;

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = join(TMP_DIR, `cert-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

function certConfig(certDir: string, localDomains: string[] = []): Config {
  return {
    ...makeTestConfig('unused.db'),
    baseDomain: 'entra.localhost',
    origins: { ...SUB_ORIGINS },
    localDomains: Object.freeze([...localDomains]),
    tls: Object.freeze({ enabled: true, certDir }),
  } as Config;
}

describe('desiredSans (#26)', () => {
  it('covers the apex, wildcard, loopback, and subdomain origins', () => {
    const sans = desiredSans(certConfig(tempDir()));
    expect(sans.dns).toContain('entra.localhost');
    expect(sans.dns).toContain('*.entra.localhost');
    expect(sans.dns).toContain('localhost');
    expect(sans.dns).toContain('login.entra.localhost');
    expect(sans.dns).toContain('graph.entra.localhost');
    expect(sans.ips).toContain('127.0.0.1');
    expect(sans.ips).toContain('::1');
  });

  it('adds each LOCAL_DOMAINS extra plus its wildcard', () => {
    const sans = desiredSans(certConfig(tempDir(), ['contoso.test']));
    expect(sans.dns).toContain('contoso.test');
    expect(sans.dns).toContain('*.contoso.test');
  });
});

describe('certCoversDomains + regeneration (#26)', () => {
  it('generates a cert that covers the configured domain set', () => {
    const cfg = certConfig(tempDir());
    const material = resolveTlsMaterial(cfg);
    expect(material).not.toBeNull();
    expect(certCoversDomains(material!.cert, desiredSans(cfg))).toBe(true);
    // A subdomain is covered via the wildcard SAN, not an exact entry.
    expect(certCoversDomains(material!.cert, { dns: ['api.entra.localhost'], ips: [] })).toBe(true);
  });

  it('reports a domain set the cert does not cover as uncovered', () => {
    const cfg = certConfig(tempDir());
    const material = resolveTlsMaterial(cfg)!;
    expect(certCoversDomains(material.cert, { dns: ['contoso.test'], ips: [] })).toBe(false);
  });

  it('is stable across calls when the domain set is unchanged', () => {
    const dir = tempDir();
    const cfg = certConfig(dir);
    const first = resolveTlsMaterial(cfg)!;
    const second = resolveTlsMaterial(cfg)!;
    expect(certFingerprint(second.cert)).toBe(certFingerprint(first.cert));
  });

  it('regenerates the persisted cert when the domain set grows', () => {
    const dir = tempDir();
    const first = resolveTlsMaterial(certConfig(dir))!;
    const widened = certConfig(dir, ['contoso.test']);
    const regenerated = resolveTlsMaterial(widened)!;

    expect(certFingerprint(regenerated.cert)).not.toBe(certFingerprint(first.cert));
    expect(certCoversDomains(regenerated.cert, desiredSans(widened))).toBe(true);
  });
});
