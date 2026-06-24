import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config/schema.js';
import { TENANT_ENDPOINTS, tenantRoute } from '../http/pathmap.js';
import { tenantGuard } from '../http/tenant.js';
import type { Store } from '../store/store.js';
import type { AppRegistration, User } from '../store/types.js';
import type { TokenService } from '../tokens/service.js';
import { createAuthStateSigner, type AuthorizeState, type AuthStateSigner } from './authState.js';
import { buildIssuer } from './metadata.js';
import {
  renderAccountPicker,
  renderErrorPage,
  renderPasswordForm,
  SIGNIN_FIELDS,
} from './signinPage.js';

/**
 * `GET|POST /{tenant}/oauth2/v2.0/authorize` (feature #6): validate the authorization request,
 * render the interactive account-picker (or password form) sign-in page, honor an existing emulator
 * session for SSO, and on selection issue an authorization code and redirect back to the registered
 * `redirect_uri`. Replaces the reserved `501` stub for this exact path.
 *
 * Security invariants: an invalid/unregistered `client_id` or `redirect_uri` renders a 400 error
 * page and NEVER redirects (open-redirect protection); all other invalid requests redirect back to
 * the validated `redirect_uri` with an OAuth `error`. The interactive POST resumes the original
 * request from a signed, integrity-protected hidden field.
 */

/** Session cookie name. */
const SESSION_COOKIE = 'el_session';
/** Interactive session lifetime (seconds) — 8h; backs both the cookie Max-Age and the row TTL. */
const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;

/** Cookie tracking UPNs already used to sign in on this device (UX hint for the many-users picker). */
const RECENT_COOKIE = 'el_recent';
/** Cap on remembered recent accounts. */
const RECENT_MAX = 8;
/** Recent-accounts cookie lifetime (30 days). */
const RECENT_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** Read the device's previously-used UPNs from the recent cookie (most-recent first). */
function readRecentUpns(request: FastifyRequest): string[] {
  const raw = request.cookies[RECENT_COOKIE];
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENT_MAX);
    }
  } catch {
    /* malformed cookie — ignore */
  }
  return [];
}

/** Record a successfully-used UPN at the front of the recent cookie (deduped, capped). */
function rememberRecentUpn(request: FastifyRequest, reply: FastifyReply, upn: string): void {
  const current = readRecentUpns(request);
  const next = [upn, ...current.filter((u) => u.toLowerCase() !== upn.toLowerCase())].slice(
    0,
    RECENT_MAX,
  );
  void reply.setCookie(RECENT_COOKIE, JSON.stringify(next), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: RECENT_COOKIE_MAX_AGE,
  });
}

/** Resolve an enabled user by UPN, case-insensitively, within the configured tenant. */
function resolveUserByEmail(store: Store, email: string): User | undefined {
  const exact = store.users.getByUpn(email);
  if (exact) return exact;
  const lower = email.toLowerCase();
  return store.users.list({ top: 1000 }).find((u) => u.userPrincipalName.toLowerCase() === lower);
}

/** OIDC/grant scopes that are not resource permissions. */
const OIDC_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access']);

type ParamSource = Record<string, unknown> | undefined;

/** Read a single string param from a parsed query/body record (first value wins for arrays). */
function getParam(source: ParamSource, key: string): string | undefined {
  if (!source) return undefined;
  const v = source[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
}

/** Split a scope string into its space-delimited parts (empties dropped). */
function splitScopes(scope: string): string[] {
  return scope.split(/\s+/).filter((s) => s.length > 0);
}

/**
 * Resolve the resource identifier driving the audience rule from the requested scopes: the prefix
 * of the first fully-qualified resource scope (`api://<guid>/scope` → `api://<guid>`;
 * `https://graph.microsoft.com/.default` → `https://graph.microsoft.com`). OIDC-only requests
 * resolve to `null` (audience then falls back to the Graph resource per #5).
 */
function resolveResource(scopes: readonly string[]): string | null {
  for (const s of scopes) {
    if (OIDC_SCOPES.has(s)) continue;
    const schemeIdx = s.indexOf('://');
    if (schemeIdx === -1) continue;
    const slash = s.lastIndexOf('/');
    return slash > schemeIdx + 2 ? s.slice(0, slash) : s;
  }
  return null;
}

/**
 * Whether every requested resource scope is registered/allowed. OIDC scopes and Graph scopes always
 * pass; bare (unqualified) scopes are accepted leniently; a fully-qualified `api://...` scope must
 * resolve to a registered, enabled scope on the named resource app — otherwise it is invalid.
 */
function scopesAreValid(scopes: readonly string[], store: Store, config: Config): boolean {
  for (const s of scopes) {
    if (OIDC_SCOPES.has(s)) continue;
    const schemeIdx = s.indexOf('://');
    if (schemeIdx === -1) continue; // bare scope: lenient
    const slash = s.lastIndexOf('/');
    const prefix = slash > schemeIdx + 2 ? s.slice(0, slash) : s;
    const bare = slash > schemeIdx + 2 ? s.slice(slash + 1) : s;
    if (prefix === config.graphResourceId || prefix === 'https://graph.microsoft.com') continue;
    const app = store.apps.getByAppIdUri(prefix);
    if (!app) return false;
    if (bare === '.default') continue;
    const ok = store.apps.listScopes(app.appId).some((sc) => sc.value === bare && sc.isEnabled);
    if (!ok) return false;
  }
  return true;
}

interface ValidatedAuthorize {
  app: AppRegistration;
  redirectUri: string;
  responseMode: 'query' | 'fragment';
  scope: string;
  scopes: string[];
  resource: string | null;
  state?: string;
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  prompt?: string;
  loginHint?: string;
}

type ValidationOutcome =
  | { kind: 'errorPage'; title: string; message: string }
  | {
      kind: 'redirectError';
      redirectUri: string;
      responseMode: 'query' | 'fragment';
      error: string;
      description: string;
      state?: string;
    }
  | { kind: 'ok'; validated: ValidatedAuthorize };

/** Validate an authorization request (the rules in spec §"Validation rules (authorize)"). */
function validateAuthorize(source: ParamSource, store: Store, config: Config): ValidationOutcome {
  const clientId = getParam(source, 'client_id');
  if (!clientId) {
    return { kind: 'errorPage', title: 'Invalid request', message: 'Missing client_id parameter.' };
  }
  const app = store.apps.getByAppId(clientId);
  if (!app) {
    return {
      kind: 'errorPage',
      title: 'Unknown application',
      message: `No application is registered with client_id '${clientId}'.`,
    };
  }

  const redirectUri = getParam(source, 'redirect_uri');
  if (!redirectUri) {
    return {
      kind: 'errorPage',
      title: 'Invalid request',
      message: 'Missing redirect_uri parameter.',
    };
  }
  const registered = store.apps.listRedirectUris(app.appId).some((r) => r.uri === redirectUri);
  if (!registered) {
    return {
      kind: 'errorPage',
      title: 'Invalid redirect URI',
      message: `The redirect URI '${redirectUri}' is not registered for this application.`,
    };
  }

  // redirect_uri is now trusted — remaining errors redirect back to it.
  const responseModeRaw = getParam(source, 'response_mode') ?? 'query';
  if (responseModeRaw !== 'query' && responseModeRaw !== 'fragment') {
    return {
      kind: 'redirectError',
      redirectUri,
      responseMode: 'query',
      error: 'invalid_request',
      description: `Unsupported response_mode '${responseModeRaw}'.`,
      state: getParam(source, 'state'),
    };
  }
  const responseMode = responseModeRaw;
  const state = getParam(source, 'state');

  const redirErr = (error: string, description: string): ValidationOutcome => ({
    kind: 'redirectError',
    redirectUri,
    responseMode,
    error,
    description,
    state,
  });

  const responseType = getParam(source, 'response_type');
  if (responseType !== 'code') {
    return redirErr('unsupported_response_type', "Only response_type 'code' is supported.");
  }

  const scope = getParam(source, 'scope');
  if (!scope || splitScopes(scope).length === 0) {
    return redirErr('invalid_request', 'Missing scope parameter.');
  }
  const scopes = splitScopes(scope);
  if (!scopesAreValid(scopes, store, config)) {
    return redirErr('invalid_scope', 'One or more requested scopes are not registered or allowed.');
  }

  const codeChallenge = getParam(source, 'code_challenge');
  const codeChallengeMethod = getParam(source, 'code_challenge_method');
  if (!app.isConfidential && !codeChallenge) {
    return redirErr('invalid_request', 'A PKCE code_challenge is required for public clients.');
  }
  if (codeChallenge) {
    const method = codeChallengeMethod ?? 'plain';
    if (method !== 'S256' && method !== 'plain') {
      return redirErr('invalid_request', `Unsupported code_challenge_method '${method}'.`);
    }
  }

  const validated: ValidatedAuthorize = {
    app,
    redirectUri,
    responseMode,
    scope,
    scopes,
    resource: resolveResource(scopes),
    ...(state !== undefined ? { state } : {}),
    ...(getParam(source, 'nonce') !== undefined ? { nonce: getParam(source, 'nonce') } : {}),
    ...(codeChallenge !== undefined ? { codeChallenge } : {}),
    ...(codeChallengeMethod !== undefined ? { codeChallengeMethod } : {}),
    ...(getParam(source, 'prompt') !== undefined ? { prompt: getParam(source, 'prompt') } : {}),
    ...(getParam(source, 'login_hint') !== undefined
      ? { loginHint: getParam(source, 'login_hint') }
      : {}),
  };
  return { kind: 'ok', validated };
}

/** Build the redirect URL appending params per `response_mode` (query or fragment). */
function buildRedirect(
  redirectUri: string,
  params: Record<string, string | undefined>,
  mode: 'query' | 'fragment',
): string {
  const url = new URL(redirectUri);
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.append(k, v);
  }
  if (mode === 'fragment') {
    url.hash = sp.toString();
  } else {
    for (const [k, v] of sp) url.searchParams.append(k, v);
  }
  return url.toString();
}

/** Send an HTML response with no-store caching. */
function sendHtml(reply: FastifyReply, status: number, html: string): void {
  void reply
    .code(status)
    .header('cache-control', 'no-store')
    .type('text/html; charset=utf-8')
    .send(html);
}

/** Convert an AuthorizeState (from a verified signed field) into a ValidatedAuthorize. */
function stateToValidated(state: AuthorizeState, app: AppRegistration): ValidatedAuthorize {
  return {
    app,
    redirectUri: state.redirectUri,
    responseMode: state.responseMode,
    scope: state.scope,
    scopes: state.scopes,
    resource: state.resource,
    ...(state.state !== undefined ? { state: state.state } : {}),
    ...(state.nonce !== undefined ? { nonce: state.nonce } : {}),
    ...(state.codeChallenge !== undefined ? { codeChallenge: state.codeChallenge } : {}),
    ...(state.codeChallengeMethod !== undefined
      ? { codeChallengeMethod: state.codeChallengeMethod }
      : {}),
  };
}

/** Convert a ValidatedAuthorize into the snapshot embedded in the signed hidden field. */
function validatedToState(v: ValidatedAuthorize): AuthorizeState {
  return {
    clientId: v.app.appId,
    redirectUri: v.redirectUri,
    scope: v.scope,
    responseMode: v.responseMode,
    resource: v.resource,
    scopes: v.scopes,
    ...(v.state !== undefined ? { state: v.state } : {}),
    ...(v.nonce !== undefined ? { nonce: v.nonce } : {}),
    ...(v.codeChallenge !== undefined ? { codeChallenge: v.codeChallenge } : {}),
    ...(v.codeChallengeMethod !== undefined ? { codeChallengeMethod: v.codeChallengeMethod } : {}),
  };
}

interface AuthorizeContext {
  store: Store;
  config: Config;
  tokenService: TokenService;
  signer: AuthStateSigner;
  issuer: string;
}

/** Issue an authorization code for the (app, user) and redirect back with `code` + `state`. */
function issueCodeAndRedirect(
  reply: FastifyReply,
  ctx: AuthorizeContext,
  v: ValidatedAuthorize,
  user: User,
): void {
  const code = ctx.tokenService.issueAuthCode({
    appId: v.app.appId,
    userId: user.id,
    redirectUri: v.redirectUri,
    scopes: v.scopes,
    resource: v.resource,
    codeChallenge: v.codeChallenge ?? null,
    codeChallengeMethod: v.codeChallengeMethod ?? null,
    nonce: v.nonce ?? null,
  });
  const url = buildRedirect(
    v.redirectUri,
    { code, ...(v.state !== undefined ? { state: v.state } : {}) },
    v.responseMode,
  );
  void reply.header('cache-control', 'no-store').redirect(url, 302);
}

/** Send an authorize error redirect (RFC 6749 §4.1.2.1) back to the validated redirect_uri. */
function redirectError(
  reply: FastifyReply,
  o: ValidationOutcome & { kind: 'redirectError' },
): void {
  const url = buildRedirect(
    o.redirectUri,
    {
      error: o.error,
      error_description: o.description,
      ...(o.state !== undefined ? { state: o.state } : {}),
    },
    o.responseMode,
  );
  void reply.header('cache-control', 'no-store').redirect(url, 302);
}

/** Resolve a valid (non-expired, enabled-user) session from the request cookie, if any. */
function resolveSession(request: FastifyRequest, store: Store): User | undefined {
  const sid = request.cookies[SESSION_COOKIE];
  if (!sid) return undefined;
  const now = Math.floor(Date.now() / 1000);
  const session = store.sessions.get(sid);
  if (!session || session.expiresAt <= now) return undefined;
  const user = store.users.getById(session.userId);
  if (!user || !user.accountEnabled) return undefined;
  return user;
}

/** Render the appropriate sign-in surface (account-picker or password form) for a validated req. */
function renderSignIn(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: AuthorizeContext,
  tenant: string,
  v: ValidatedAuthorize,
  opts: { error?: string; username?: string | null } = {},
): void {
  const actionPath = `/${tenant}/${TENANT_ENDPOINTS.authorize}`;
  const signedState = ctx.signer.sign(validatedToState(v));
  const shared = {
    actionPath,
    signedState,
    appName: v.app.displayName,
    continueTo: v.redirectUri,
    tenantId: ctx.config.tenantId,
    issuer: ctx.issuer,
  };
  if (ctx.config.requirePassword) {
    sendHtml(
      reply,
      200,
      renderPasswordForm({
        ...shared,
        username: opts.username ?? v.loginHint ?? null,
        error: opts.error ?? null,
      }),
    );
    return;
  }
  sendHtml(
    reply,
    200,
    renderAccountPicker({
      ...shared,
      users: store_enabledUsers(ctx.store),
      recentUpns: readRecentUpns(request),
      loginHint: v.loginHint ?? null,
      error: opts.error ?? null,
    }),
  );
}

/** Enabled users for the configured tenant, ordered for a stable picker. */
function store_enabledUsers(store: Store): User[] {
  return store.users.list({ top: 100 }).filter((u) => u.accountEnabled);
}

/** Handle an initial authorize request (GET, or POST without the signed sign-in field). */
function handleInitialAuthorize(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: AuthorizeContext,
  source: ParamSource,
): void {
  const tenant = (request.params as { tenant?: string }).tenant ?? ctx.config.tenantId;
  const outcome = validateAuthorize(source, ctx.store, ctx.config);
  if (outcome.kind === 'errorPage') {
    sendHtml(
      reply,
      400,
      renderErrorPage({
        title: outcome.title,
        message: outcome.message,
        tenantId: ctx.config.tenantId,
        issuer: ctx.issuer,
      }),
    );
    return;
  }
  if (outcome.kind === 'redirectError') {
    redirectError(reply, outcome);
    return;
  }

  const v = outcome.validated;
  const prompt = v.prompt;
  const sessionUser = resolveSession(request, ctx.store);

  if (prompt === 'none') {
    if (sessionUser) {
      issueCodeAndRedirect(reply, ctx, v, sessionUser);
    } else {
      redirectError(reply, {
        kind: 'redirectError',
        redirectUri: v.redirectUri,
        responseMode: v.responseMode,
        error: 'login_required',
        description: 'No active emulator session; interactive sign-in is required.',
        ...(v.state !== undefined ? { state: v.state } : {}),
      });
    }
    return;
  }

  const forceInteractive = prompt === 'select_account' || prompt === 'login';
  if (sessionUser && !forceInteractive) {
    issueCodeAndRedirect(reply, ctx, v, sessionUser);
    return;
  }

  renderSignIn(request, reply, ctx, tenant, v);
}

/** Handle the interactive sign-in submission (POST carrying the signed `__el_state` field). */
function handleSignInSubmit(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: AuthorizeContext,
  body: Record<string, unknown>,
): void {
  const tenant = (request.params as { tenant?: string }).tenant ?? ctx.config.tenantId;
  const signed = getParam(body, SIGNIN_FIELDS.state);
  const state = signed ? ctx.signer.verify(signed) : undefined;
  if (!state) {
    sendHtml(
      reply,
      400,
      renderErrorPage({
        title: 'Invalid request',
        message: 'The sign-in request could not be verified. Please restart sign-in.',
        tenantId: ctx.config.tenantId,
        issuer: ctx.issuer,
      }),
    );
    return;
  }

  // Defense-in-depth: re-validate client + redirect against the store (never trust the field alone).
  const app = ctx.store.apps.getByAppId(state.clientId);
  const registered =
    app && ctx.store.apps.listRedirectUris(app.appId).some((r) => r.uri === state.redirectUri);
  if (!app || !registered) {
    sendHtml(
      reply,
      400,
      renderErrorPage({
        title: 'Invalid request',
        message: 'The application or redirect URI is no longer valid.',
        tenantId: ctx.config.tenantId,
        issuer: ctx.issuer,
      }),
    );
    return;
  }

  const v = stateToValidated(state, app);

  let user: User | undefined;
  if (ctx.config.requirePassword) {
    const username = getParam(body, SIGNIN_FIELDS.username) ?? '';
    const password = getParam(body, SIGNIN_FIELDS.password) ?? '';
    const candidate = ctx.store.users.getByUpn(username);
    if (
      !candidate ||
      !candidate.accountEnabled ||
      !ctx.store.users.verifyPassword(candidate.id, password)
    ) {
      renderSignIn(request, reply, ctx, tenant, v, {
        error: 'That username or password is incorrect. Please try again.',
        username,
      });
      return;
    }
    user = candidate;
  } else {
    // The picker posts a selected account id (`__el_user`); the many-users view posts a typed
    // account email (`__el_email`) instead. Prefer the explicit id when both are present.
    const userId = getParam(body, SIGNIN_FIELDS.user) ?? '';
    const email = (getParam(body, SIGNIN_FIELDS.email) ?? '').trim();
    const candidate = userId
      ? ctx.store.users.getById(userId)
      : email
        ? resolveUserByEmail(ctx.store, email)
        : undefined;
    if (!candidate || !candidate.accountEnabled || candidate.tenantId !== ctx.config.tenantId) {
      renderSignIn(request, reply, ctx, tenant, v, {
        error: 'That account is not available. Please choose another account.',
      });
      return;
    }
    user = candidate;
  }

  // Create the SSO session + cookie, then issue the code.
  const now = Math.floor(Date.now() / 1000);
  const session = ctx.store.sessions.create({
    userId: user.id,
    expiresAt: now + SESSION_LIFETIME_SECONDS,
  });
  void reply.setCookie(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: ctx.config.tls.enabled,
    maxAge: SESSION_LIFETIME_SECONDS,
  });

  // Remember this account on the device so the many-users picker can surface it next time.
  // Set after the session cookie so the session cookie stays the primary `Set-Cookie`.
  rememberRecentUpn(request, reply, user.userPrincipalName);

  issueCodeAndRedirect(reply, ctx, v, user);
}

/**
 * Register the real `/authorize` GET + POST handlers (replacing the reserved `501` stubs). The
 * tenant guard keeps an unknown tenant as a JSON `400 invalid_request` (locked routing contract).
 */
export function registerAuthorizeRoutes(app: FastifyInstance): void {
  const ctx: AuthorizeContext = {
    store: app.store,
    config: app.config,
    tokenService: app.tokenService,
    signer: createAuthStateSigner(),
    issuer: buildIssuer(app.config),
  };
  const guard = { preHandler: tenantGuard('oauth') };

  app.get(
    tenantRoute(TENANT_ENDPOINTS.authorize),
    guard,
    (request: FastifyRequest, reply: FastifyReply): void => {
      handleInitialAuthorize(request, reply, ctx, request.query as ParamSource);
    },
  );

  app.post(
    tenantRoute(TENANT_ENDPOINTS.authorize),
    guard,
    (request: FastifyRequest, reply: FastifyReply): void => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (typeof body[SIGNIN_FIELDS.state] === 'string') {
        handleSignInSubmit(request, reply, ctx, body);
      } else {
        handleInitialAuthorize(request, reply, ctx, body);
      }
    },
  );
}
