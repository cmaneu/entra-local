import type { App } from '../api/types';

/**
 * Per-app MSAL configuration snippet generator.
 *
 * All emitted identifiers are deterministic from the app registration plus the emulator's
 * discovery/config (issuer → public origin + tenant), so the snippet is byte-stable for a given
 * seed/config. The generator emits only scopes the emulator accepts (OIDC scopes, the recognized
 * Graph delegated scope `User.Read`, or `<resource>/.default` for confidential clients) so a
 * pasted config never trips `invalid_scope`.
 */

/** Microsoft Graph resource identifier (the `.default` audience), per the emulator default. */
const GRAPH_RESOURCE = 'https://graph.microsoft.com';

/** A syntax-tinted token. `k` drives the light tinting that mirrors brand/portal.html. */
export interface Tok {
  t: string;
  k?: 'key' | 'str' | 'com' | 'fn';
}
export type Line = Tok[];

export interface SnippetInputs {
  app: App;
  /** Discovery/config issuer, e.g. `https://localhost:8443/<tenant>/v2.0`. */
  issuer: string;
  tenantId: string;
  /** A chosen registered redirect URI (falls back to a localhost example when none exist). */
  redirectUri: string;
}

export interface SnippetValues {
  clientId: string;
  authority: string;
  knownAuthorities: string[];
  redirectUri: string;
  graphBase: string;
  /** Public-client / delegated login scopes (msal-browser). */
  loginScopes: string[];
  /** Confidential-client `.default` scope (msal-node client credentials). */
  defaultScope: string;
  publicOrigin: string;
  host: string;
}

/** Derive the public origin + host from the discovery issuer (config-exact). */
export function deriveOrigin(issuer: string): { origin: string; host: string } {
  try {
    const u = new URL(issuer);
    return { origin: u.origin, host: u.host };
  } catch {
    return { origin: issuer, host: issuer };
  }
}

/** Resolve the deterministic snippet values for an app. */
export function snippetValues(inputs: SnippetInputs): SnippetValues {
  const { origin, host } = deriveOrigin(inputs.issuer);
  const resource =
    inputs.app.appIdUri && inputs.app.appIdUri.length > 0 ? inputs.app.appIdUri : GRAPH_RESOURCE;
  return {
    clientId: inputs.app.id,
    authority: `${origin}/${inputs.tenantId}`,
    knownAuthorities: [host],
    redirectUri: inputs.redirectUri,
    graphBase: `${origin}/graph`,
    loginScopes: ['openid', 'profile', 'email', 'offline_access', 'User.Read'],
    defaultScope: `${resource}/.default`,
    publicOrigin: origin,
    host,
  };
}

const s = (t: string): Tok => ({ t });
const key = (t: string): Tok => ({ t, k: 'key' });
const str = (t: string): Tok => ({ t, k: 'str' });
const com = (t: string): Tok => ({ t, k: 'com' });

function jsArray(values: string[]): Tok[] {
  const out: Tok[] = [s('[')];
  values.forEach((v, i) => {
    out.push(str(`"${v}"`));
    if (i < values.length - 1) out.push(s(', '));
  });
  out.push(s(']'));
  return out;
}

/** Build the `@azure/msal-browser` PublicClientApplication snippet (lines of tinted tokens). */
export function browserSnippet(v: SnippetValues): Line[] {
  return [
    [
      key('import'),
      s(' { PublicClientApplication } '),
      key('from'),
      s(' '),
      str('"@azure/msal-browser"'),
      s(';'),
    ],
    [],
    [key('const'), s(' msalConfig = {')],
    [s('  auth: {')],
    [s('    clientId: '), str(`"${v.clientId}"`), s(',')],
    [s('    authority: '), str(`"${v.authority}"`), s(',')],
    [
      s('    knownAuthorities: '),
      ...jsArray(v.knownAuthorities),
      s(',   '),
      com('// custom authority — required'),
    ],
    [s('    redirectUri: '), str(`"${v.redirectUri}"`), s(',')],
    [s('    protocolMode: '), str('"OIDC"')],
    [s('  },')],
    [s('  cache: { cacheLocation: '), str('"sessionStorage"'), s(' }')],
    [s('};')],
    [],
    [key('export const'), s(' loginRequest = {')],
    [s('  scopes: '), ...jsArray(v.loginScopes)],
    [s('};')],
    [],
    [com('// Microsoft Graph (minimal emulator)')],
    [key('export const'), s(' graphConfig = { graphBase: '), str(`"${v.graphBase}"`), s(' };')],
  ];
}

/** Build the `@azure/msal-node` ConfidentialClientApplication snippet (lines of tinted tokens). */
export function nodeSnippet(v: SnippetValues): Line[] {
  return [
    [
      key('import'),
      s(' { ConfidentialClientApplication } '),
      key('from'),
      s(' '),
      str('"@azure/msal-node"'),
      s(';'),
    ],
    [],
    [key('const'), s(' cca = '), key('new'), s(' ConfidentialClientApplication({')],
    [s('  auth: {')],
    [s('    clientId: '), str(`"${v.clientId}"`), s(',')],
    [s('    authority: '), str(`"${v.authority}"`), s(',')],
    [s('    knownAuthorities: '), ...jsArray(v.knownAuthorities), s(',')],
    [
      s('    clientSecret: '),
      str('"<your-client-secret>"'),
      s('   '),
      com('// create one under Client secrets'),
    ],
    [s('  }')],
    [s('});')],
    [],
    [com('// Client-credentials (app-only) token for the resource:')],
    [key('const'), s(' result = '), key('await'), s(' cca.acquireTokenByClientCredential({')],
    [s('  scopes: '), ...jsArray([v.defaultScope])],
    [s('});')],
  ];
}

/** Flatten tinted lines to plain text (used for the copy button + tests). */
export function snippetText(lines: Line[]): string {
  return lines.map((line) => line.map((tok) => tok.t).join('')).join('\n');
}
