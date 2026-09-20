import type { Configuration, RedirectRequest } from '@azure/msal-browser';

const origin = import.meta.env.VITE_EMULATOR_ORIGIN ?? 'https://localhost:8443';
const tenantId = import.meta.env.VITE_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';
const clientId = import.meta.env.VITE_CLIENT_ID ?? 'cccccccc-0000-0000-0000-000000000008';
const apiAppId = import.meta.env.VITE_API_APP_ID ?? 'cccccccc-0000-0000-0000-000000000009';

export const apiBase = import.meta.env.VITE_API_BASE ?? 'http://localhost:4001';
export const apiScope = import.meta.env.VITE_API_SCOPE ?? `api://${apiAppId}/access_as_user`;

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `${origin}/${tenantId}`,
    knownAuthorities: [new URL(origin).host],
    redirectUri: import.meta.env.VITE_REDIRECT_URI ?? 'http://localhost:5174',
  },
  cache: { cacheLocation: 'sessionStorage' },
};

export const loginRequest: RedirectRequest = {
  scopes: ['openid', 'profile', 'offline_access', apiScope],
};
