import type { Line, Tok } from './msalSnippet';

/** Supported host platforms for the copy-paste trust scripts. */
export type TrustPlatform = 'windows' | 'macos' | 'linux';

/** The platform tab strip (order = Windows, macOS, Linux). */
export const TRUST_PLATFORMS: { id: TrustPlatform; label: string }[] = [
  { id: 'windows', label: 'Windows' },
  { id: 'macos', label: 'macOS' },
  { id: 'linux', label: 'Linux' },
];

/** Best-effort guess of the visitor's platform, for defaulting the active tab. */
export function detectPlatform(): TrustPlatform {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
  return 'linux';
}

/** The (same-origin) URL the cert PEM is downloaded from. */
export function certPemUrl(origin: string): string {
  return `${origin}/admin/api/certificate/pem`;
}

const s = (t: string): Tok => ({ t });
const com = (t: string): Tok => ({ t, k: 'com' });
const str = (t: string): Tok => ({ t, k: 'str' });

/**
 * Build a self-contained "download + trust" script for the given platform + emulator origin. The
 * script downloads the cert over the emulator's own (not-yet-trusted) origin while skipping
 * certificate validation — safe here because the downloaded file is exactly the cert being trusted,
 * and its fingerprint is shown in the UI for verification. Every platform downloads with `curl`
 * (`curl.exe` on Windows 10 1803+, aliased away from PowerShell's `Invoke-WebRequest`).
 */
export function trustScript(platform: TrustPlatform, origin: string): Line[] {
  const url = certPemUrl(origin);
  if (platform === 'windows') {
    return [
      [
        com(
          '# Run in PowerShell — downloads the cert with curl.exe, then trusts it in your user Root store.',
        ),
      ],
      [
        com(
          '# (Use curl.exe explicitly — in PowerShell bare `curl` is an alias for the built-in web cmdlet.)',
        ),
      ],
      [s('$cert = "$env:TEMP\\entra-local-ca.crt"')],
      [s('curl.exe -sk '), str(`"${url}"`), s(' -o $cert')],
      [s('Import-Certificate -FilePath $cert -CertStoreLocation Cert:\\CurrentUser\\Root')],
    ];
  }
  if (platform === 'macos') {
    return [
      [com('# Downloads the cert, then trusts it in your login keychain.')],
      [s('curl -sk '), str(`"${url}"`), s(' -o /tmp/entra-local-ca.crt')],
      [s('security add-trusted-cert -r trustRoot \\')],
      [s('  -k ~/Library/Keychains/login.keychain-db /tmp/entra-local-ca.crt')],
    ];
  }
  return [
    [com('# Downloads the cert, then trusts it in the system CA store (Debian/Ubuntu).')],
    [s('curl -sk '), str(`"${url}"`), s(' -o /tmp/entra-local-ca.crt')],
    [s('sudo cp /tmp/entra-local-ca.crt /usr/local/share/ca-certificates/entra-local.crt')],
    [s('sudo update-ca-certificates')],
  ];
}

/**
 * The `NODE_EXTRA_CA_CERTS` hint. Node-based clients (MSAL Node, fetch, etc.) ignore the OS trust
 * store, so they must be pointed at the downloaded cert file directly.
 */
export function nodeCaHint(platform: TrustPlatform): string {
  const file = platform === 'windows' ? '$env:TEMP\\entra-local-ca.crt' : '/tmp/entra-local-ca.crt';
  return platform === 'windows'
    ? `$env:NODE_EXTRA_CA_CERTS = "${file}"`
    : `export NODE_EXTRA_CA_CERTS="${file}"`;
}
