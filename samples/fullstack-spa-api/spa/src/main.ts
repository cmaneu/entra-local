import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
} from '@azure/msal-browser';
import { API_BASE, loginRequest, logoutRequest, msalConfig, tokenRequest } from './authConfig.js';

/**
 * Smoke hook: the CI Playwright test reads `window.__smoke` to assert the end-to-end flow without
 * scraping the DOM. Mirrors the visible UI state.
 */
interface SmokeState {
  signedIn: boolean;
  username?: string;
  todosStatus?: number;
  todosOk?: boolean;
  accessTokenClaims?: Record<string, unknown>;
  apiCaller?: Record<string, unknown>;
  error?: string;
}
declare global {
  interface Window {
    __smoke: SmokeState;
    /**
     * Test hook used by the CI smoke (`smoke.mjs`) to acquire a raw access token for an arbitrary
     * scope after sign-in. Harmless in a sample; lets the smoke assert 200/403 with real tokens.
     * `forceRefresh` bypasses the access-token cache so a narrower scope set is re-minted from the
     * refresh token (used to obtain an `access_as_admin`-only token for the 403 case).
     */
    __acquireToken?: (scope: string, forceRefresh?: boolean) => Promise<string>;
  }
}
window.__smoke = { signedIn: false };

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const els = {
  signin: $<HTMLButtonElement>('signin'),
  signout: $<HTMLButtonElement>('signout'),
  loadTodos: $<HTMLButtonElement>('load-todos'),
  status: $<HTMLParagraphElement>('status'),
  accountCard: $<HTMLElement>('account-card'),
  account: $<HTMLParagraphElement>('account'),
  todosCard: $<HTMLElement>('todos-card'),
  todos: $<HTMLPreElement>('todos'),
  claimsCard: $<HTMLElement>('claims-card'),
  claims: $<HTMLPreElement>('claims'),
  apiCaller: $<HTMLPreElement>('api-caller'),
};

const pca = new PublicClientApplication(msalConfig);

function setStatus(message: string, isError = false): void {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
  if (isError) window.__smoke.error = message;
}

/** Decode a JWT payload for display only (no verification — the API does that). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function renderSignedIn(account: AccountInfo): void {
  window.__smoke.signedIn = true;
  window.__smoke.username = account.username;
  els.signin.hidden = true;
  els.signout.hidden = false;
  els.loadTodos.disabled = false;
  els.accountCard.hidden = false;
  els.account.textContent = `${account.name ?? account.username} (${account.username})`;
  setStatus('Signed in. Click "Load todos" to call the protected API.');
}

function renderSignedOut(): void {
  window.__smoke = { signedIn: false };
  els.signin.hidden = false;
  els.signout.hidden = true;
  els.loadTodos.disabled = true;
  els.accountCard.hidden = true;
  els.todosCard.hidden = true;
  els.claimsCard.hidden = true;
  setStatus('Not signed in.');
}

/** Acquire an access token for the API, falling back to an interactive redirect when needed. */
async function getApiToken(account: AccountInfo): Promise<string> {
  try {
    const result: AuthenticationResult = await pca.acquireTokenSilent({
      ...tokenRequest,
      account,
    });
    return result.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      await pca.acquireTokenRedirect({ ...tokenRequest, account });
    }
    throw err;
  }
}

async function loadTodos(): Promise<void> {
  const account = pca.getActiveAccount();
  if (!account) {
    setStatus('No active account; sign in first.', true);
    return;
  }
  setStatus('Acquiring access token and calling the API…');
  try {
    const token = await getApiToken(account);
    const claims = decodeJwtPayload(token);
    if (claims) {
      window.__smoke.accessTokenClaims = claims;
      els.claims.textContent = JSON.stringify(
        { aud: claims.aud, scp: claims.scp, azp: claims.azp, oid: claims.oid },
        null,
        2,
      );
      els.claimsCard.hidden = false;
    }

    const res = await fetch(`${API_BASE}/api/todos`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    window.__smoke.todosStatus = res.status;
    window.__smoke.todosOk = res.ok;
    const body = (await res.json()) as { todos?: unknown; caller?: Record<string, unknown> };

    if (!res.ok) {
      setStatus(`API returned ${res.status}.`, true);
      els.todos.textContent = JSON.stringify(body, null, 2);
      els.todosCard.hidden = false;
      return;
    }

    window.__smoke.apiCaller = body.caller;
    els.todos.textContent = JSON.stringify(body.todos, null, 2);
    els.apiCaller.textContent = JSON.stringify(body.caller, null, 2);
    els.todosCard.hidden = false;
    setStatus(`API returned 200 OK. Token audience = ${String(claims?.aud ?? 'unknown')}.`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Failed to load todos.', true);
  }
}

async function main(): Promise<void> {
  await pca.initialize();

  // Complete a redirect sign-in if we are returning from the emulator.
  const redirectResult = await pca.handleRedirectPromise();
  if (redirectResult?.account) {
    pca.setActiveAccount(redirectResult.account);
  } else {
    const existing = pca.getActiveAccount() ?? pca.getAllAccounts()[0];
    if (existing) pca.setActiveAccount(existing);
  }

  const active = pca.getActiveAccount();
  if (active) renderSignedIn(active);
  else renderSignedOut();

  window.__acquireToken = async (scope: string, forceRefresh = false): Promise<string> => {
    const account = pca.getActiveAccount();
    if (!account) throw new Error('Not signed in.');
    const result = await pca.acquireTokenSilent({ scopes: [scope], account, forceRefresh });
    return result.accessToken;
  };

  els.signin.addEventListener('click', () => {
    void pca.loginRedirect(loginRequest);
  });
  els.signout.addEventListener('click', () => {
    const account = pca.getActiveAccount() ?? undefined;
    // Full front-channel sign-out: navigate to the emulator's end-session endpoint so it clears its
    // SSO session cookie (not just the local MSAL cache), then returns here via the "Return to
    // application" link on the emulator's signed-out page. MSAL clears the local cache before
    // navigating, so on return the SPA renders the signed-out state.
    void pca.logoutRedirect({ ...logoutRequest, account });
  });
  els.loadTodos.addEventListener('click', () => {
    void loadTodos();
  });
}

void main();
