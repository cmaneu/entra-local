import { describe, expect, it } from 'vitest';
import type { App } from '../api/types';
import {
  browserSnippet,
  deriveOrigin,
  nodeSnippet,
  snippetText,
  snippetValues,
} from './msalSnippet';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ISSUER = `https://localhost:8443/${TENANT}/v2.0`;

function makeApp(over: Partial<App> = {}): App {
  return {
    id: 'cccccccc-0000-0000-0000-000000000001',
    displayName: 'Contoso SPA',
    isConfidential: false,
    appIdUri: null,
    redirectUris: [],
    exposedScopes: [],
    appRoles: [],
    secrets: [],
    createdAt: '2026-06-22T00:00:00.000Z',
    ...over,
  };
}

describe('msalSnippet', () => {
  it('derives the public origin + host from the discovery issuer', () => {
    expect(deriveOrigin(ISSUER)).toEqual({
      origin: 'https://localhost:8443',
      host: 'localhost:8443',
    });
  });

  it('computes deterministic snippet values from app + discovery/config', () => {
    const app = makeApp();
    const v = snippetValues({
      app,
      issuer: ISSUER,
      tenantId: TENANT,
      redirectUri: 'https://localhost:3000/auth/callback',
    });
    expect(v.clientId).toBe(app.id);
    expect(v.authority).toBe(`https://localhost:8443/${TENANT}`);
    expect(v.knownAuthorities).toEqual(['localhost:8443']);
    expect(v.redirectUri).toBe('https://localhost:3000/auth/callback');
    expect(v.graphBase).toBe('https://localhost:8443/graph');
    expect(v.loginScopes).toEqual(['openid', 'profile', 'email', 'offline_access', 'User.Read']);
  });

  it('uses the Graph resource for .default when no appIdUri is set, else the appIdUri', () => {
    const pub = snippetValues({
      app: makeApp(),
      issuer: ISSUER,
      tenantId: TENANT,
      redirectUri: 'https://localhost:3000/cb',
    });
    expect(pub.defaultScope).toBe('https://graph.microsoft.com/.default');

    const conf = snippetValues({
      app: makeApp({ isConfidential: true, appIdUri: `api://${TENANT}` }),
      issuer: ISSUER,
      tenantId: TENANT,
      redirectUri: 'https://localhost:3000/cb',
    });
    expect(conf.defaultScope).toBe(`api://${TENANT}/.default`);
  });

  it('renders the msal-browser snippet with all key values', () => {
    const v = snippetValues({
      app: makeApp(),
      issuer: ISSUER,
      tenantId: TENANT,
      redirectUri: 'https://localhost:3000/auth/callback',
    });
    const text = snippetText(browserSnippet(v));
    expect(text).toContain('@azure/msal-browser');
    expect(text).toContain(`clientId: "${v.clientId}"`);
    expect(text).toContain(`authority: "https://localhost:8443/${TENANT}"`);
    expect(text).toContain('knownAuthorities: ["localhost:8443"]');
    expect(text).toContain('redirectUri: "https://localhost:3000/auth/callback"');
    expect(text).toContain('"openid", "profile", "email", "offline_access", "User.Read"');
    expect(text).toContain('graphBase: "https://localhost:8443/graph"');
  });

  it('renders the msal-node snippet with the .default scope', () => {
    const v = snippetValues({
      app: makeApp({ isConfidential: true }),
      issuer: ISSUER,
      tenantId: TENANT,
      redirectUri: 'https://localhost:3000/cb',
    });
    const text = snippetText(nodeSnippet(v));
    expect(text).toContain('@azure/msal-node');
    expect(text).toContain('ConfidentialClientApplication');
    expect(text).toContain('https://graph.microsoft.com/.default');
  });
});
