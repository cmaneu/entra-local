import type {
  Configuration,
  EndSessionRequest,
  PopupRequest,
  RedirectRequest,
} from '@azure/msal-browser';

/**
 * SPA configuration for the Entra Local full-stack sample (feature #24).
 *
 * Defaults target the emulator's seeded full-stack apps:
 *   - SPA front app   `cccccccc-0000-0000-0000-000000000004` (this app)
 *   - API resource app `cccccccc-0000-0000-0000-000000000005` (exposes `access_as_user`)
 *
 * Every value is overridable through a `VITE_*` env var (see `.env.example`) so the sample runs
 * against a non-default emulator without code changes.
 */
const EMULATOR_ORIGIN = import.meta.env.VITE_EMULATOR_ORIGIN ?? 'https://localhost:8443';
const TENANT_ID = import.meta.env.VITE_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';
const CLIENT_ID = import.meta.env.VITE_CLIENT_ID ?? 'cccccccc-0000-0000-0000-000000000004';
const API_APP_ID = import.meta.env.VITE_API_APP_ID ?? 'cccccccc-0000-0000-0000-000000000005';
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI ?? 'http://localhost:5173';

/**
 * Where the emulator sends the user back after sign-out. The emulator's end-session endpoint
 * validates this **exactly** against the redirect URIs registered for the SPA app (`…0004`) and
 * only then offers a "Return to application" link back to it, so it must match a registered URI.
 * Defaults to the SPA's own redirect URI.
 */
const POST_LOGOUT_REDIRECT_URI =
  import.meta.env.VITE_POST_LOGOUT_REDIRECT_URI ?? REDIRECT_URI;

/** Base URL of the protected Express API. */
export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:4000';

/**
 * The scope the SPA requests for the API. Because it is fully qualified with the API app's
 * App ID URI, the emulator mints an access token whose `aud` is the API app (`…0005`).
 */
export const API_SCOPE = import.meta.env.VITE_API_SCOPE ?? `api://${API_APP_ID}/access_as_user`;

/**
 * A second delegated scope the API app exposes. `/api/todos` requires `access_as_user`, so a token
 * carrying only this scope has the right `aud` but the wrong `scp`. The sample requests it at
 * sign-in so the CI smoke can prove the `403 insufficient_scope` path with a genuinely valid token.
 */
export const API_ADMIN_SCOPE =
  import.meta.env.VITE_API_ADMIN_SCOPE ?? `api://${API_APP_ID}/access_as_admin`;

export const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: `${EMULATOR_ORIGIN}/${TENANT_ID}`,
    // The emulator is not a public cloud authority; list its host so MSAL skips cloud
    // instance-discovery and trusts the local instance.
    knownAuthorities: [new URL(EMULATOR_ORIGIN).host],
    redirectUri: REDIRECT_URI,
  },
  cache: { cacheLocation: 'sessionStorage' },
};

/**
 * Interactive sign-in. We request the API scopes up front (not just OIDC) because the Entra Local
 * emulator scopes its refresh tokens strictly: a later silent request may only ask for scopes that
 * were granted at sign-in. Requesting the API scope here is what lets `acquireTokenSilent` mint the
 * API access token without a second interactive round-trip. `offline_access` yields a refresh token.
 */
export const loginRequest: RedirectRequest & PopupRequest = {
  scopes: ['openid', 'profile', 'offline_access', API_SCOPE, API_ADMIN_SCOPE],
};

/** Token request for the protected API (drives `aud`=API app, `scp`=access_as_user). */
export const tokenRequest = { scopes: [API_SCOPE] };

/**
 * Sign-out request. Drives `logoutRedirect` to the emulator's `end_session_endpoint`
 * (`/{tenant}/oauth2/v2.0/logout`) so the emulator clears its SSO session cookie — a full
 * front-channel sign-out, not just a local MSAL cache clear.
 *
 * The emulator only shows its "Return to application" link when `post_logout_redirect_uri` matches a
 * redirect URI registered for a resolvable client. `@azure/msal-browser` does not send `client_id`
 * on logout, so we pass it via `extraQueryParameters` for the emulator to resolve the SPA app
 * (`…0004`) and validate the post-logout URI against its registered redirect URIs.
 */
export const logoutRequest: EndSessionRequest = {
  postLogoutRedirectUri: POST_LOGOUT_REDIRECT_URI,
  extraQueryParameters: { client_id: CLIENT_ID },
};
