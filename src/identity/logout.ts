import { decodeJwt } from 'jose';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config/schema.js';
import { TENANT_ENDPOINTS, tenantRoute } from '../http/pathmap.js';
import { tenantGuard } from '../http/tenant.js';
import type { Store } from '../store/store.js';
import { buildIssuer } from './metadata.js';
import { renderSignedOutPage } from './signinPage.js';

/**
 * Front-channel logout / end-session endpoint (feature #9): `GET /{tenant}/oauth2/v2.0/logout`.
 * Clears the emulator SSO session (the `sessions` row + the signed cookie) and, when a validated
 * `post_logout_redirect_uri` is supplied, renders a signed-out page with a "Return to application"
 * link to it; otherwise it renders the signed-out page without that link. Replaces the reserved
 * `501` stub advertised by discovery (#4) as `end_session_endpoint`.
 *
 * Security: the "Return to application" link is shown only when `post_logout_redirect_uri`
 * **exactly** matches a redirect URI registered for the resolved `client_id` (the `client_id`
 * param, or — best-effort, signature NOT enforced — the `id_token_hint`'s `aud`). With no
 * resolvable `client_id` or no exact match the page is rendered without the link.
 *
 * Logout is **idempotent**: a missing/invalid session still succeeds and still clears the cookie.
 */

/** Session cookie name (shared with the #6 authorize flow). */
const SESSION_COOKIE = 'el_session';

interface LogoutContext {
  store: Store;
  config: Config;
  issuer: string;
}

type QuerySource = Record<string, unknown> | undefined;

/** Read a single string query param (first value wins for arrays). */
function getParam(source: QuerySource, key: string): string | undefined {
  if (!source) return undefined;
  const v = source[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
}

/** Best-effort `client_id` from the unverified `id_token_hint` `aud` claim (signature not checked). */
function clientIdFromHint(idTokenHint: string | undefined): string | undefined {
  if (!idTokenHint) return undefined;
  try {
    const claims = decodeJwt(idTokenHint);
    const aud = claims.aud;
    if (typeof aud === 'string') return aud;
    if (Array.isArray(aud) && typeof aud[0] === 'string') return aud[0];
    return undefined;
  } catch {
    return undefined;
  }
}

/** Render the signed-out confirmation page (200). */
function renderSignedOut(reply: FastifyReply, ctx: LogoutContext, returnTo?: string): void {
  void reply
    .code(200)
    .header('cache-control', 'no-store')
    .type('text/html; charset=utf-8')
    .send(
      renderSignedOutPage({
        tenantId: ctx.config.tenantId,
        issuer: ctx.issuer,
        returnToApplicationUrl: returnTo,
      }),
    );
}

/** Handle the end-session request: clear the session, then redirect or render the signed-out page. */
function handleLogout(request: FastifyRequest, reply: FastifyReply, ctx: LogoutContext): void {
  // 1) Clear the SSO session (idempotent) + expire the cookie regardless of validity.
  const sid = request.cookies[SESSION_COOKIE];
  if (sid) ctx.store.sessions.delete(sid);
  void reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.tls.enabled,
  });

  const query = request.query as QuerySource;
  const postLogoutRedirectUri = getParam(query, 'post_logout_redirect_uri');
  if (!postLogoutRedirectUri) {
    renderSignedOut(reply, ctx);
    return;
  }

  // 2) Resolve the client whose registered redirect URIs gate the post-logout URI.
  const clientId =
    getParam(query, 'client_id') ?? clientIdFromHint(getParam(query, 'id_token_hint'));
  if (!clientId) {
    renderSignedOut(reply, ctx);
    return;
  }
  const app = ctx.store.apps.getByAppId(clientId);
  const registered =
    app && ctx.store.apps.listRedirectUris(app.appId).some((r) => r.uri === postLogoutRedirectUri);
  if (!registered) {
    renderSignedOut(reply, ctx);
    return;
  }

  // 3) Validated: keep the signed-out page, but offer a return link (echoing `state` if provided).
  const target = new URL(postLogoutRedirectUri);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    renderSignedOut(reply, ctx);
    return;
  }
  const state = getParam(query, 'state');
  if (state !== undefined) target.searchParams.append('state', state);
  renderSignedOut(reply, ctx, target.toString());
}

/**
 * Register the real `/logout` GET handler (replacing the reserved `501` stub). The tenant guard
 * keeps an unknown tenant as a JSON `400 invalid_request` (locked routing contract).
 */
export function registerLogoutRoute(app: FastifyInstance): void {
  const ctx: LogoutContext = {
    store: app.store,
    config: app.config,
    issuer: buildIssuer(app.config),
  };
  const guard = { preHandler: tenantGuard('oauth') };

  app.get(
    tenantRoute(TENANT_ENDPOINTS.logout),
    guard,
    (request: FastifyRequest, reply: FastifyReply): void => {
      handleLogout(request, reply, ctx);
    },
  );
}
