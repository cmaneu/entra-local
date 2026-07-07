import { describe, expect, it } from 'vitest';
import { snippetText } from './msalSnippet';
import { certPemUrl, nodeCaHint, trustScript, TRUST_PLATFORMS } from './certTrust';

const ORIGIN = 'https://localhost:8443';

describe('certTrust', () => {
  it('builds the same-origin PEM download URL', () => {
    expect(certPemUrl(ORIGIN)).toBe('https://localhost:8443/admin/api/certificate/pem');
  });

  it('lists the three supported platforms', () => {
    expect(TRUST_PLATFORMS.map((p) => p.id)).toEqual(['windows', 'macos', 'linux']);
  });

  it('emits a Windows script that downloads with curl.exe then trusts the cert', () => {
    const text = snippetText(trustScript('windows', ORIGIN));
    // curl.exe (not the `curl` alias for Invoke-WebRequest) so the download works on Windows 10+.
    expect(text).toContain('curl.exe -sk');
    expect(text).not.toContain('Invoke-WebRequest');
    expect(text).toContain(certPemUrl(ORIGIN));
    expect(text).toContain('Import-Certificate');
    expect(text).toContain('Cert:\\CurrentUser\\Root');
  });

  it('emits a macOS security add-trusted-cert script into the login keychain', () => {
    const text = snippetText(trustScript('macos', ORIGIN));
    expect(text).toContain('security add-trusted-cert -r trustRoot');
    expect(text).toContain('login.keychain-db');
    expect(text).toContain(certPemUrl(ORIGIN));
  });

  it('emits a Linux update-ca-certificates script', () => {
    const text = snippetText(trustScript('linux', ORIGIN));
    expect(text).toContain('sudo cp');
    expect(text).toContain('/usr/local/share/ca-certificates/entra-local.crt');
    expect(text).toContain('sudo update-ca-certificates');
  });

  it('gives a platform-appropriate NODE_EXTRA_CA_CERTS hint', () => {
    expect(nodeCaHint('windows')).toContain('$env:NODE_EXTRA_CA_CERTS');
    expect(nodeCaHint('linux')).toContain('export NODE_EXTRA_CA_CERTS=');
    expect(nodeCaHint('macos')).toContain('export NODE_EXTRA_CA_CERTS=');
  });
});
