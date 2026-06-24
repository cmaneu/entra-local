import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config/schema.js';
import { TENANT_ENDPOINTS, tenantRoute } from '../http/pathmap.js';
import { tenantGuard } from '../http/tenant.js';
import type { Store } from '../store/store.js';
import type { DeviceCode, Session, User } from '../store/types.js';
import { createSignedStateSigner, type SignedStateSigner } from './authState.js';
import { field, type Body } from './clientAuth.js';
import { normalizeUserCode } from './deviceCode.js';
import { buildIssuer } from './metadata.js';
import { splitScopes } from './scopes.js';
import {
  DEVICE_FIELDS,
  renderAccountPicker,
  renderDeviceCodeEntry,
  renderDeviceConsent,
  renderDeviceResult,
  renderErrorPage,
  renderPasswordForm,
  SIGNIN_FIELDS,
} from './signinPage.js';

/**
 * The human-facing approval surface for the device-code flow (#15): a code-entry page
 * (`GET /devicecode`) and a `lookup → signin → decide` state machine (`POST /devicecode/verify`).
 * Reuses #6's sign-in chrome (account-picker / password form, `el_session` SSO) and the `el_session`
 * cookie. CSRF is enforced on the `decide` step by a signed `DeviceApprovalState` whose `sid` must
 * match the live session id; the device code is re-validated server-side on every step.
 */

/** Session cookie name (shared with #6). */
const SESSION_COOKIE = 'el_session';
/** Interactive session lifetime (seconds) — 8h, matching #6. */
const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
/** Recent-accounts cookie (UX hint for the many-users picker), matching #6. */
const RECENT_COOKIE = 'el_recent';
const RECENT_MAX = 8;
const RECENT_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * The signed, HMAC-integrity-protected snapshot carried across the approval steps. `sid` is the live
 * `el_session` id and is **required**: every consent render binds the state to the session, and the
 * `decide` step rejects a missing/mismatched `sid` (CSRF protection).
 */
export interface DeviceApprovalState {
  userCode: string;
  sid: string;
}

interface ApprovalContext {
  store: Store;
  config: Config;
  signer: SignedStateSigner<DeviceApprovalState>;
  issuer: string;
}

/** Current time as integer Unix epoch seconds. */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Send an HTML response with no-store caching. */
function sendHtml(reply: FastifyReply, status: number, html: string): void {
  void reply
    .code(status)
    .header('cache-control', 'no-store')
    .type('text/html; charset=utf-8')
    .send(html);
}

/** Resolve a valid (non-expired, enabled-user) session row + user from the request cookie. */
function resolveSession(
  request: FastifyRequest,
  store: Store,
): { session: Session; user: User } | undefined {
  const sid = request.cookies[SESSION_COOKIE];
  if (!sid) return undefined;
  const now = nowSeconds();
  const session = store.sessions.get(sid);
  if (!session || session.expiresAt <= now) return undefined;
  const user = store.users.getById(session.userId);
  if (!user || !user.accountEnabled) return undefined;
  return { session, user };
}

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

/** The `/verify` form POST target for a given tenant alias. */
function verifyPath(tenant: string): string {
  return `/${tenant}/${TENANT_ENDPOINTS.devicecode}/verify`;
}

/** Render an approval-flow error page (HTTP 200 HTML, no redirect). */
function errorPage(
  reply: FastifyReply,
  ctx: ApprovalContext,
  title: string,
  message: string,
): void {
  sendHtml(
    reply,
    200,
    renderErrorPage({ title, message, tenantId: ctx.config.tenantId, issuer: ctx.issuer }),
  );
}

/** Enabled users for the configured tenant, ordered for a stable picker. */
function enabledUsers(store: Store): User[] {
  return store.users.list({ top: 100 }).filter((u) => u.accountEnabled);
}

/** Render the sign-in surface (account-picker or password form) for the device approval flow. */
function renderSignIn(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: ApprovalContext,
  tenant: string,
  row: DeviceCode,
  app: { displayName: string },
  opts: { error?: string } = {},
): void {
  // No session yet at the sign-in render; `sid` is re-signed with the real session id post-signin.
  const signedState = ctx.signer.sign({ userCode: row.userCode, sid: '' });
  const shared = {
    actionPath: verifyPath(tenant),
    signedState,
    appName: app.displayName,
    continueTo: app.displayName,
    tenantId: ctx.config.tenantId,
    issuer: ctx.issuer,
    extraHiddenFields: { [DEVICE_FIELDS.step]: 'signin', [DEVICE_FIELDS.userCode]: row.userCode },
  };
  if (ctx.config.requirePassword) {
    sendHtml(reply, 200, renderPasswordForm({ ...shared, error: opts.error ?? null }));
    return;
  }
  sendHtml(
    reply,
    200,
    renderAccountPicker({
      ...shared,
      users: enabledUsers(ctx.store),
      recentUpns: readRecentUpns(request),
      error: opts.error ?? null,
    }),
  );
}

/** Render the consent screen, signing a fresh state bound to the live session id. */
function renderConsent(
  reply: FastifyReply,
  ctx: ApprovalContext,
  tenant: string,
  row: DeviceCode,
  session: Session,
  user: User,
): void {
  const app = ctx.store.apps.getByAppId(row.appId);
  const signedState = ctx.signer.sign({ userCode: row.userCode, sid: session.id });
  sendHtml(
    reply,
    200,
    renderDeviceConsent({
      actionPath: verifyPath(tenant),
      signedState,
      appName: app?.displayName ?? row.appId,
      scopes: splitScopes(row.scopes),
      username: user.userPrincipalName,
      tenantId: ctx.config.tenantId,
      issuer: ctx.issuer,
    }),
  );
}

/**
 * Re-load + re-validate a device code by (normalized) user code. Returns the pending, unexpired row,
 * or an error-page reason string. Expired/denied/approved rows surface a specific message and are
 * lazily deleted when expired.
 */
function loadPendingByUserCode(
  ctx: ApprovalContext,
  userCode: string,
): { row: DeviceCode } | { error: string } {
  const row = ctx.store.deviceCodes.getByUserCode(userCode);
  if (!row) return { error: "That code wasn't found. Check the code and try again." };
  if (row.expiresAt <= nowSeconds()) {
    ctx.store.deviceCodes.consume(row.deviceCode);
    return { error: 'This code has expired. Restart sign-in on your device.' };
  }
  if (row.status === 'denied') return { error: 'This request was denied.' };
  if (row.status !== 'pending') return { error: 'This code was already used.' };
  return { row };
}

/** `GET /{tenant}/oauth2/v2.0/devicecode` — the code-entry page (optionally pre-filled). */
function handleGet(request: FastifyRequest, reply: FastifyReply, ctx: ApprovalContext): void {
  const tenant = (request.params as { tenant?: string }).tenant ?? ctx.config.tenantId;
  const query = request.query as Record<string, unknown>;
  const prefill = field(query, 'user_code');
  sendHtml(
    reply,
    200,
    renderDeviceCodeEntry({
      actionPath: verifyPath(tenant),
      userCode: prefill ?? null,
      tenantId: ctx.config.tenantId,
      issuer: ctx.issuer,
    }),
  );
}

/** `__el_step=lookup`: normalize + look up the user code, then route to consent or sign-in. */
function handleLookup(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: ApprovalContext,
  body: Body,
  tenant: string,
): void {
  const userCode = normalizeUserCode(field(body, DEVICE_FIELDS.userCode) ?? '');
  const loaded = loadPendingByUserCode(ctx, userCode);
  if ('error' in loaded) {
    errorPage(reply, ctx, 'Code not available', loaded.error);
    return;
  }
  const row = loaded.row;
  const app = ctx.store.apps.getByAppId(row.appId);
  if (!app) {
    errorPage(reply, ctx, 'Code not available', 'The requesting application is no longer valid.');
    return;
  }

  const sess = resolveSession(request, ctx.store);
  if (sess) {
    renderConsent(reply, ctx, tenant, row, sess.session, sess.user);
    return;
  }
  renderSignIn(request, reply, ctx, tenant, row, app);
}

/** `__el_step=signin`: authenticate the user, set `el_session` first, then re-render consent. */
function handleSignin(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: ApprovalContext,
  body: Body,
  tenant: string,
): void {
  const signed = field(body, SIGNIN_FIELDS.state);
  const state = signed ? ctx.signer.verify(signed) : undefined;
  if (!state) {
    errorPage(reply, ctx, 'Invalid request', 'The sign-in request could not be verified.');
    return;
  }

  const loaded = loadPendingByUserCode(ctx, state.userCode);
  if ('error' in loaded) {
    errorPage(reply, ctx, 'Code not available', loaded.error);
    return;
  }
  const row = loaded.row;
  const app = ctx.store.apps.getByAppId(row.appId);
  if (!app) {
    errorPage(reply, ctx, 'Code not available', 'The requesting application is no longer valid.');
    return;
  }

  let user: User | undefined;
  if (ctx.config.requirePassword) {
    const username = field(body, SIGNIN_FIELDS.username) ?? '';
    const password = field(body, SIGNIN_FIELDS.password) ?? '';
    const candidate = ctx.store.users.getByUpn(username);
    if (
      !candidate ||
      !candidate.accountEnabled ||
      !ctx.store.users.verifyPassword(candidate.id, password)
    ) {
      renderSignIn(request, reply, ctx, tenant, row, app, {
        error: 'That username or password is incorrect. Please try again.',
      });
      return;
    }
    user = candidate;
  } else {
    const userId = field(body, SIGNIN_FIELDS.user) ?? '';
    const email = (field(body, SIGNIN_FIELDS.email) ?? '').trim();
    const candidate = userId
      ? ctx.store.users.getById(userId)
      : email
        ? resolveUserByEmail(ctx.store, email)
        : undefined;
    if (!candidate || !candidate.accountEnabled || candidate.tenantId !== ctx.config.tenantId) {
      renderSignIn(request, reply, ctx, tenant, row, app, {
        error: 'That account is not available. Please choose another account.',
      });
      return;
    }
    user = candidate;
  }

  // Create the SSO session + cookie. The session cookie MUST be Set-Cookie[0] (cookie-ordering
  // invariant — integration helpers read Set-Cookie[0]); the recent cookie follows.
  const session = ctx.store.sessions.create({
    userId: user.id,
    expiresAt: nowSeconds() + SESSION_LIFETIME_SECONDS,
  });
  void reply.setCookie(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: ctx.config.tls.enabled,
    maxAge: SESSION_LIFETIME_SECONDS,
  });
  rememberRecentUpn(request, reply, user.userPrincipalName);

  renderConsent(reply, ctx, tenant, row, session, user);
}

/** `__el_step=decide`: verify CSRF (`sid`), re-validate the code, then approve/deny. */
function handleDecide(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: ApprovalContext,
  body: Body,
): void {
  const signed = field(body, SIGNIN_FIELDS.state);
  const state = signed ? ctx.signer.verify(signed) : undefined;
  if (!state) {
    errorPage(reply, ctx, 'Invalid request', 'The approval request could not be verified.');
    return;
  }

  // CSRF: require a live session AND a signed `sid` that matches it.
  const sess = resolveSession(request, ctx.store);
  if (!sess || !state.sid || state.sid !== sess.session.id) {
    errorPage(
      reply,
      ctx,
      'Could not verify this request',
      'This approval request could not be verified. Please restart from your device.',
    );
    return;
  }

  const loaded = loadPendingByUserCode(ctx, state.userCode);
  if ('error' in loaded) {
    errorPage(reply, ctx, 'Code not available', loaded.error);
    return;
  }
  const row = loaded.row;

  const decision = field(body, DEVICE_FIELDS.decision);
  if (decision === 'approve') {
    const approved = ctx.store.deviceCodes.approve(row.userCode, sess.session.userId);
    if (!approved) {
      errorPage(reply, ctx, 'Code not available', 'This code was already used.');
      return;
    }
    sendHtml(
      reply,
      200,
      renderDeviceResult({
        heading: "You're all set",
        message: 'Return to your device to continue. You can close this window.',
        tenantId: ctx.config.tenantId,
        issuer: ctx.issuer,
      }),
    );
    return;
  }

  if (decision === 'deny') {
    ctx.store.deviceCodes.deny(row.userCode);
    sendHtml(
      reply,
      200,
      renderDeviceResult({
        heading: 'Request denied',
        message: 'You denied the sign-in request. You can close this window.',
        tenantId: ctx.config.tenantId,
        issuer: ctx.issuer,
      }),
    );
    return;
  }

  errorPage(reply, ctx, 'Invalid request', 'No decision was provided.');
}

/** Register `GET /devicecode` (code-entry page) + `POST /devicecode/verify` (state machine). */
export function registerDeviceApprovalRoutes(app: FastifyInstance): void {
  const ctx: ApprovalContext = {
    store: app.store,
    config: app.config,
    signer: createSignedStateSigner<DeviceApprovalState>(),
    issuer: buildIssuer(app.config),
  };
  const guard = { preHandler: tenantGuard('oauth') };

  app.get(
    tenantRoute(TENANT_ENDPOINTS.devicecode),
    guard,
    (request: FastifyRequest, reply: FastifyReply): void => {
      handleGet(request, reply, ctx);
    },
  );

  app.post(
    tenantRoute(`${TENANT_ENDPOINTS.devicecode}/verify`),
    guard,
    (request: FastifyRequest, reply: FastifyReply): void => {
      const tenant = (request.params as { tenant?: string }).tenant ?? ctx.config.tenantId;
      const body = (request.body ?? {}) as Body;
      const step = field(body, DEVICE_FIELDS.step);
      if (step === 'lookup') {
        handleLookup(request, reply, ctx, body, tenant);
      } else if (step === 'signin') {
        handleSignin(request, reply, ctx, body, tenant);
      } else if (step === 'decide') {
        handleDecide(request, reply, ctx, body);
      } else {
        errorPage(reply, ctx, 'Invalid request', 'Unrecognized approval step.');
      }
    },
  );
}
