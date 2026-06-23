import type { User } from '../store/types.js';

/**
 * Server-rendered sign-in / account-picker page (feature #6) — the first user-facing UI.
 *
 * Faithfully mirrors `brand/demo.html` and the DESIGN.md tokens (Azure-blue primary, Fluent gray
 * neutrals, system-ui/Selawik UI font + Cascadia Mono for identifiers, 4px/8px radii, the
 * dark-ink-on-amber LOCAL EMULATOR badge). No framework, no external assets: a single inline-styled
 * document so it works standalone over the emulator origin. The portal SPA (#12) is separate.
 *
 * The functional contract asserted by tests is independent of styling: the account-picker lists the
 * enabled seeded users and submits `__el_user`; the password form submits `__el_username` +
 * `__el_password`; both carry the signed `__el_state` that resumes the authorize request.
 */

/** Hidden form field names that drive the interactive sign-in POST back to `/authorize`. */
export const SIGNIN_FIELDS = {
  /** Signed, integrity-protected snapshot of the original authorize params. */
  state: '__el_state',
  /** Account-picker: the selected user's object id. */
  user: '__el_user',
  /** Password mode: the typed user principal name. */
  username: '__el_username',
  /** Password mode: the typed password. */
  password: '__el_password',
} as const;

/** Escape a string for safe interpolation into HTML text / double-quoted attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Initials (1–2 chars) derived from a display name, for the account avatar. */
function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Deterministic avatar background from the DESIGN palette, keyed by user id. */
const AVATAR_COLORS = ['#0078D4', '#038387', '#8A8886', '#005A9E', '#015A5D'] as const;
function avatarColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

const SHARED_STYLE = `
  :root{
    --primary-40:#005A9E;--primary-50:#106EBE;--primary-60:#0078D4;
    --accent-60:#038387;--caution-50:#F59E0B;--caution-80:#92400E;
    --neutral-10:#201F1E;--neutral-20:#323130;--neutral-40:#605E5C;--neutral-60:#8A8886;
    --neutral-80:#E1DFDD;--neutral-85:#EDEBE9;--neutral-95:#FAF9F8;--neutral-100:#FFFFFF;
    --error-60:#D13438;--error-80:#A4262C;--error-90:#FDE7E9;
    --surface:#FFFFFF;--surface-alt:#FAF9F8;--on-surface:#201F1E;
    --font-ui:"Segoe UI","Selawik",system-ui,-apple-system,sans-serif;
    --font-mono:"Cascadia Mono","Cascadia Code",ui-monospace,Consolas,monospace;
    --r-md:4px;--r-lg:8px;
    --depth-8:0 1.6px 3.6px rgba(0,0,0,.13),0 0.3px 0.9px rgba(0,0,0,.11);
  }
  *{box-sizing:border-box;}
  body{font-family:var(--font-ui);color:var(--on-surface);background:var(--surface-alt);
       min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;margin:0;}
  .mono{font-family:var(--font-mono);}
  .card{background:var(--surface);width:440px;max-width:100%;border-radius:var(--r-lg);
        box-shadow:var(--depth-8);padding:44px;}
  .head{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;}
  .app{display:flex;align-items:center;gap:8px;}
  .applogo{width:28px;height:28px;border-radius:var(--r-md);background:var(--primary-60);color:#fff;
           display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;}
  .appname{font-weight:600;font-size:15px;}
  .badge{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
         background:var(--caution-50);color:var(--neutral-10);border-radius:var(--r-md);
         padding:3px 8px;display:inline-flex;gap:5px;align-items:center;}
  h1{font-size:28px;font-weight:600;letter-spacing:-.01em;margin:0 0 4px;}
  .sub{font-size:14px;margin:0 0 20px;color:var(--neutral-40);}
  .acct{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:10px 8px;
        border:none;background:transparent;border-radius:var(--r-md);cursor:pointer;font-family:inherit;}
  .acct:hover{background:var(--neutral-95);} .acct:active{background:var(--neutral-85);}
  .acct:focus-visible{outline:2px solid var(--primary-60);outline-offset:1px;}
  .avatar{width:32px;height:32px;border-radius:9999px;display:flex;align-items:center;
          justify-content:center;color:#fff;font-size:13px;font-weight:600;flex:none;}
  .name{font-size:14px;font-weight:600;color:var(--neutral-10);display:block;}
  .upn{font-size:12px;color:var(--neutral-40);}
  label{display:block;font-size:14px;font-weight:600;color:var(--neutral-20);margin:0 0 6px;}
  input[type=text],input[type=password]{width:100%;height:36px;padding:0 10px;font-size:14px;
        font-family:inherit;border:1px solid var(--neutral-60);border-radius:var(--r-md);
        background:var(--surface);margin-bottom:16px;}
  input:focus{outline:2px solid var(--primary-60);outline-offset:0;border-color:var(--primary-60);}
  button.primary{height:32px;padding:0 20px;border:none;border-radius:var(--r-md);
        background:var(--primary-60);color:#fff;font-size:14px;font-weight:600;font-family:inherit;
        cursor:pointer;}
  button.primary:hover{background:var(--primary-50);}
  button.primary:active{background:var(--primary-40);}
  button.primary:focus-visible{outline:2px solid var(--neutral-10);outline-offset:2px;}
  .err{background:var(--error-90);color:var(--error-80);border-radius:var(--r-md);
       padding:12px 16px;font-size:14px;margin:0 0 16px;}
  .foot{margin-top:24px;padding-top:16px;border-top:1px solid var(--neutral-85);}
  .foot p{font-size:12px;color:var(--neutral-40);margin:0;}
  .foot .warn{color:var(--caution-80);font-weight:600;}
  .foot .meta{font-size:11px;color:var(--neutral-60);margin-top:8px;}
  .divider{height:1px;background:var(--neutral-85);margin:6px 0;}
`;

/** Common page shell (doctype, head, badge header). */
function page(
  title: string,
  appName: string,
  body: string,
  ariaLabel = 'Sign in to Entra Local',
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} — Entra Local</title>
<style>${SHARED_STYLE}</style>
</head>
<body>
<main class="card" role="dialog" aria-label="${escapeHtml(ariaLabel)}">
  <div class="head">
    <div class="app">
      <div class="applogo" aria-hidden="true">${escapeHtml(initials(appName))}</div>
      <span class="appname">${escapeHtml(appName)}</span>
    </div>
    <span class="badge" title="This is a local emulator, not Microsoft Entra ID">▲ Local Emulator</span>
  </div>
  ${body}
</main>
</body>
</html>`;
}

/** Standard footer disclaimer shared by every sign-in variant. */
function footer(tenantId: string, issuer: string): string {
  return `<div class="foot">
    <p><span class="warn">Not for production use.</span>
       Entra Local is a local emulator of Microsoft Entra ID for development and testing.
       Accounts and tokens here are fake. It is not Microsoft and not affiliated with Microsoft.</p>
    <p class="meta mono">tenant ${escapeHtml(tenantId)} · issuer ${escapeHtml(issuer)}</p>
  </div>`;
}

export interface SignInPageOptions {
  /** The form POST target (`/{tenant}/oauth2/v2.0/authorize`). */
  actionPath: string;
  /** Signed, integrity-protected authorize-params snapshot. */
  signedState: string;
  /** The calling app's display name (header + "continue to"). */
  appName: string;
  /** Where the user is signing in to continue (redirect_uri), shown mono. */
  continueTo: string;
  tenantId: string;
  issuer: string;
}

export interface AccountPickerOptions extends SignInPageOptions {
  /** Enabled users to list. */
  users: readonly User[];
  /** Optional login_hint UPN to visually pre-select. */
  loginHint?: string | null;
  /** Optional error banner (e.g. disabled/unknown account). */
  error?: string | null;
}

/** Render the passwordless account-picker page (default sign-in UX). */
export function renderAccountPicker(options: AccountPickerOptions): string {
  const accounts = options.users
    .map((u) => {
      const selected = options.loginHint && u.userPrincipalName === options.loginHint;
      return `<button class="acct" type="submit" name="${SIGNIN_FIELDS.user}" value="${escapeHtml(u.id)}"${
        selected ? ' autofocus aria-current="true"' : ''
      }>
        <span class="avatar" style="background:${avatarColor(u.id)}" aria-hidden="true">${escapeHtml(initials(u.displayName))}</span>
        <span><span class="name">${escapeHtml(u.displayName)}</span><span class="upn">${escapeHtml(u.userPrincipalName)}</span></span>
      </button>`;
    })
    .join('\n');

  const body = `<h1>Sign in</h1>
  <p class="sub">to continue to <span class="mono" style="font-size:13px">${escapeHtml(options.continueTo)}</span></p>
  ${options.error ? `<div class="err" role="alert">${escapeHtml(options.error)}</div>` : ''}
  <form method="post" action="${escapeHtml(options.actionPath)}">
    <input type="hidden" name="${SIGNIN_FIELDS.state}" value="${escapeHtml(options.signedState)}" />
    <div role="list" aria-label="Pick an account">
      ${accounts}
    </div>
  </form>
  ${footer(options.tenantId, options.issuer)}`;

  return page('Sign in', options.appName, body);
}

export interface PasswordFormOptions extends SignInPageOptions {
  /** Pre-filled username (login_hint or the previously typed value). */
  username?: string | null;
  /** Optional error banner (wrong credentials). */
  error?: string | null;
}

/** Render the username + password sign-in form (`REQUIRE_PASSWORD=true`). */
export function renderPasswordForm(options: PasswordFormOptions): string {
  const body = `<h1>Sign in</h1>
  <p class="sub">to continue to <span class="mono" style="font-size:13px">${escapeHtml(options.continueTo)}</span></p>
  ${options.error ? `<div class="err" role="alert">${escapeHtml(options.error)}</div>` : ''}
  <form method="post" action="${escapeHtml(options.actionPath)}">
    <input type="hidden" name="${SIGNIN_FIELDS.state}" value="${escapeHtml(options.signedState)}" />
    <label for="el-username">Username</label>
    <input id="el-username" type="text" name="${SIGNIN_FIELDS.username}" autocomplete="username"
           autofocus value="${escapeHtml(options.username ?? '')}" placeholder="user@entralocal.dev" />
    <label for="el-password">Password</label>
    <input id="el-password" type="password" name="${SIGNIN_FIELDS.password}"
           autocomplete="current-password" />
    <button class="primary" type="submit">Sign in</button>
  </form>
  ${footer(options.tenantId, options.issuer)}`;

  return page('Sign in', options.appName, body);
}

export interface ErrorPageOptions {
  title: string;
  message: string;
  tenantId: string;
  issuer: string;
}

/**
 * Render a non-redirecting error page (HTTP 400) for invalid `client_id`/`redirect_uri` — these
 * must NEVER redirect to an unvalidated URI (open-redirect protection).
 */
export function renderErrorPage(options: ErrorPageOptions): string {
  const body = `<h1>${escapeHtml(options.title)}</h1>
  <p class="sub">Entra Local could not process this sign-in request.</p>
  <div class="err" role="alert">${escapeHtml(options.message)}</div>
  ${footer(options.tenantId, options.issuer)}`;
  return page('Sign-in error', 'Entra Local', body);
}

export interface SignedOutPageOptions {
  tenantId: string;
  issuer: string;
}

/**
 * Render the minimal, accessible "signed out" confirmation page (feature #9 logout). Functional and
 * lightly styled from the shared DESIGN tokens; the full branded treatment is deferred to #12.
 */
export function renderSignedOutPage(options: SignedOutPageOptions): string {
  const body = `<h1>You're signed out</h1>
  <p class="sub">Your Entra Local session has ended. You can close this window.</p>
  ${footer(options.tenantId, options.issuer)}`;
  return page('Signed out', 'Entra Local', body, 'Signed out of Entra Local');
}
