import {
  BrowserAuthError,
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
} from '@azure/msal-browser';
import {
  API_BASE,
  DISCOVERY_URL,
  EMULATOR_ORIGIN,
  PORTAL_URL,
  loginRequest,
  logoutRequest,
  msalConfig,
  tokenRequest,
} from './authConfig.js';

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
  /** True once the emulator was detected to be unreachable over HTTPS (likely untrusted cert). */
  tlsError?: boolean;
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
  tlsHelp: $<HTMLElement>('tls-help'),
  tlsOrigin: $<HTMLElement>('tls-origin'),
  portalLink: $<HTMLAnchorElement>('portal-link'),
};

const pca = new PublicClientApplication(msalConfig);

function setStatus(message: string, isError = false): void {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
  if (isError) window.__smoke.error = message;
}

/** MSAL/browser error codes that mean a request to the emulator failed at the network layer. */
const UNREACHABLE_CODES = new Set([
  'get_request_failed',
  'post_request_failed',
  'openid_config_error',
  'endpoints_resolution_error',
  'unable_to_get_openid_config',
]);

/**
 * Heuristic: does this error mean the browser could not reach the emulator over HTTPS? In local dev
 * the usual cause is that the emulator's self-signed certificate is not trusted yet, so a `fetch`
 * to its discovery/token endpoint rejects with a network `TypeError` ("Failed to fetch") — or MSAL
 * wraps that as a request-failed error. (An emulator that is simply not running looks the same.)
 */
function isEmulatorUnreachable(err: unknown): boolean {
  if (err instanceof BrowserAuthError && UNREACHABLE_CODES.has(err.errorCode)) return true;
  if (err instanceof TypeError) return true; // native fetch network failure
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') ||
    msg.includes('get_request_failed') ||
    msg.includes('openid')
  );
}

/** Show the "trust the dev certificate via the portal" banner. */
function showTlsHelp(): void {
  els.tlsHelp.hidden = false;
  window.__smoke.tlsError = true;
}

/** Hide the certificate-trust banner (the emulator is reachable). */
function hideTlsHelp(): void {
  els.tlsHelp.hidden = true;
}

/**
 * Probe the emulator's discovery document once. A network failure means the browser cannot reach
 * the emulator over HTTPS (most often an untrusted dev certificate), so we surface the portal-trust
 * banner proactively — before the user hits the unavoidable full-page certificate warning that a
 * sign-in redirect would trigger.
 */
async function probeEmulator(): Promise<void> {
  try {
    const res = await fetch(DISCOVERY_URL, { method: 'GET' });
    if (res.ok) hideTlsHelp();
  } catch (err) {
    if (isEmulatorUnreachable(err)) showTlsHelp();
  }
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
    if (isEmulatorUnreachable(err)) {
      setStatus('Could not reach the emulator over HTTPS to acquire a token.', true);
      showTlsHelp();
      return;
    }
    setStatus(err instanceof Error ? err.message : 'Failed to load todos.', true);
  }
}

/** Start an interactive sign-in, surfacing the cert-trust banner if the emulator is unreachable. */
async function signIn(): Promise<void> {
  hideTlsHelp();
  setStatus('Redirecting to the emulator to sign in…');
  try {
    await pca.loginRedirect(loginRequest);
  } catch (err) {
    if (isEmulatorUnreachable(err)) {
      setStatus('Could not reach the emulator over HTTPS.', true);
      showTlsHelp();
      return;
    }
    setStatus(err instanceof Error ? err.message : 'Sign-in failed.', true);
  }
}

async function main(): Promise<void> {
  await pca.initialize();

  // Wire the certificate-trust banner (origin label + portal link) before anything can show it.
  els.tlsOrigin.textContent = EMULATOR_ORIGIN;
  els.portalLink.href = PORTAL_URL;

  // Complete a redirect sign-in if we are returning from the emulator.
  let redirectResult: AuthenticationResult | null = null;
  try {
    redirectResult = await pca.handleRedirectPromise();
  } catch (err) {
    if (isEmulatorUnreachable(err)) showTlsHelp();
    else setStatus(err instanceof Error ? err.message : 'Sign-in failed.', true);
  }
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
    void signIn();
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

  // Best-effort reachability check: if the emulator can't be reached over HTTPS (typically an
  // untrusted dev certificate), show the portal-trust banner up front instead of only on sign-in.
  void probeEmulator();
}

void main();
