import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
} from '@azure/msal-browser';
import { apiBase, apiScope, loginRequest, msalConfig } from './authConfig.js';

interface SmokeState {
  signedIn: boolean;
  status?: number;
  result?: Record<string, unknown>;
}

declare global {
  interface Window {
    __smoke: SmokeState;
    __acquireToken?: (scope?: string, forceRefresh?: boolean) => Promise<string>;
  }
}

window.__smoke = { signedIn: false };
const pca = new PublicClientApplication(msalConfig);
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function renderAccount(account: AccountInfo | undefined) {
  const signedIn = Boolean(account);
  window.__smoke.signedIn = signedIn;
  byId<HTMLButtonElement>('signin').hidden = signedIn;
  byId<HTMLButtonElement>('call-api').disabled = !signedIn;
  byId('status').textContent = signedIn
    ? `Signed in as ${account!.username}. Ready to run the delegated exchange.`
    : 'Sign in to begin.';
}

async function acquire(scope = apiScope, forceRefresh = false): Promise<string> {
  const account = pca.getActiveAccount();
  if (!account) throw new Error('No signed-in account.');
  try {
    return (await pca.acquireTokenSilent({ account, scopes: [scope], forceRefresh })).accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      await pca.acquireTokenRedirect({ account, scopes: [scope] });
    }
    throw error;
  }
}

async function callApi() {
  byId('status').textContent = 'Exchanging SPA token through the middle tier…';
  try {
    const response = await fetch(`${apiBase}/api/me`, {
      headers: { Authorization: ['Bearer', await acquire()].join(' ') },
    });
    const result = (await response.json()) as Record<string, unknown>;
    window.__smoke = { ...window.__smoke, status: response.status, result };
    byId('result').textContent = JSON.stringify(result, null, 2);
    byId('result-card').hidden = false;
    byId('status').textContent = response.ok
      ? 'OBO complete. The API returned the local Graph profile.'
      : `API returned ${response.status}.`;
  } catch (error) {
    byId('status').textContent = error instanceof Error ? error.message : 'Request failed.';
  }
}

async function main() {
  await pca.initialize();
  const redirected = await pca.handleRedirectPromise();
  const account = redirected?.account ?? pca.getAllAccounts()[0];
  if (account) pca.setActiveAccount(account);
  renderAccount(account);
  window.__acquireToken = acquire;
  byId('signin').addEventListener('click', () => void pca.loginRedirect(loginRequest));
  byId('call-api').addEventListener('click', () => void callApi());
}

void main();
