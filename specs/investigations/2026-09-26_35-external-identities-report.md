# Investigation Report — Entra External Identities (Google/Apple SSO)

- **Issue:** [#35 — Investigation spike - Entra external identities](https://github.com/cmaneu/entra-local/issues/35)
- **Status:** Report complete. See the companion
  [`2026-09-26_35-external-identities-specifications.md`](./2026-09-26_35-external-identities-specifications.md)
  for the proposed shape of the feature if/when it is scheduled on the
  [roadmap](../roadmap.md).
- **Date:** 2026-09-26
- **Author:** Copilot (coding agent)

## 1. Objective

Explore what Microsoft Entra ID's **External Identities** capability actually does when a
developer wants their app's sign-in page to offer "Sign in with Google" / "Sign in with
Apple" (and other social/enterprise identity providers), and determine what — if
anything — Entra Local would need in order to let a developer emulate that scenario
locally, offline, without talking to Google/Apple/real Entra.

This is a research spike only: **no code changes** are made as part of this report. The
companion specifications document sketches a concrete, MSAL-compatible design that a future
roadmap feature could implement.

## 2. What "External Identities" means in real Entra ID

"External Identities" is Microsoft's umbrella term for several distinct capabilities. Only
one of them is relevant to "sign in with Google/Apple":

| Sub-capability | What it does | Relevant here? |
|---|---|---|
| **B2B collaboration** | Invite users from *other Entra tenants* (or any email) as guests in your tenant. | No — no external social IdP involved. |
| **B2B direct connect** | Trust-based collaboration between two Entra tenants (Teams shared channels). | No. |
| **Direct federation (SAML/WS-Fed)** | Trust an external SAML/WS-Fed IdP so its users can sign in as guests without a Microsoft account. | Partially — same underlying pattern (trust an external IdP), different protocol. |
| **Social identity providers (Google, Apple, Facebook)** | Trust an external **OIDC/OAuth 2.0** IdP (Google, Apple) as a federated sign-in option for guest users or, in **Entra External ID for customers (CIAM)**, for the app's own customer accounts. | **Yes — this is the scenario in the issue.** |
| **Entra External ID for customers (CIAM)** | A separate customer-facing tenant type (`*.ciamlogin.com`) with **user flows** that bundle local accounts + one or more social/enterprise IdPs behind a single "Sign in" page. | Yes — this is where Google/Apple federation is actually configured and used day-to-day. |

The scenario the issue is asking about — "developers support SSO from main providers like
Google, Apple" — is the **social identity provider federation** feature, most commonly
configured inside an **External ID for customers (CIAM)** tenant, using its **user flows**.
Entra Local models a plain workforce tenant (single-tenant, `/{tenantId}/v2.0` OIDC), so the
closest fit is the *mechanism* (federate to an external OIDC IdP and translate its token into
a first-party Entra token), not the CIAM product surface (external tenant type, user flows,
self-service sign-up) — see §5 for the scoping call.

### 2.1 How it actually works, end to end (real Entra ID)

1. **Admin registers the external IdP** in the Entra tenant (`External Identities` →
   `All identity providers`), giving it:
   - a `client_id` / `client_secret` obtained from the external provider's own developer
     console (Google Cloud Console, Apple Developer "Sign in with Apple" service ID), and
   - for OIDC providers, the provider's issuer/metadata is well-known (Google:
     `https://accounts.google.com/.well-known/openid-configuration`; Apple:
     `https://appleid.apple.com`). For arbitrary "generic OIDC" providers the admin supplies
     the OIDC metadata URL, client id/secret, and response type explicitly.
2. **The IdP is attached to a user flow** (CIAM) or made available tenant-wide (B2B social
   sign-in). This is what actually turns the IdP into a selectable sign-in *option* — merely
   registering it doesn't show it anywhere.
3. **User hits the app**, MSAL redirects to Entra's `/authorize` as normal (the app never
   talks to Google/Apple directly — it only ever sees Entra endpoints and Entra-issued
   tokens).
4. **Entra's hosted sign-in page** shows the configured options: local account fields plus a
   button per federated IdP ("Continue with Google", "Continue with Apple", ...).
5. **User picks a federated IdP.** Entra itself becomes an OAuth/OIDC **client** of that
   provider: it redirects the browser to the provider's own `/authorize` endpoint with a
   `redirect_uri` that points back at Entra (`https://<tenant>.ciamlogin.com/.../federation/oidc/...`
   or the equivalent B2B callback), the provider authenticates the user (its own UI, its own
   MFA, etc.), and redirects back to Entra with a code.
6. **Entra exchanges the code** with the provider's token endpoint (server-side, using the
   registered client secret), validates the returned ID token (issuer, audience, signature via
   the provider's JWKS), and extracts claims (`sub`, `email`, `email_verified`, `name`, ...).
7. **Just-in-time (JIT) provisioning / account linking.** Entra creates or matches a directory
   object for the external identity — a *guest user* (B2B) or a *customer account* (CIAM) —
   keyed by `issuer + sub` (and/or verified email, depending on configuration). This object is
   a normal Entra user object from that point on.
8. **Entra mints its own tokens.** Entra issues its **own** ID/access tokens to the original
   app, signed with Entra's own keys, with Entra's own `iss`/`tid`/`aud`, and an `oid` for the
   linked directory object. The app **never sees the Google/Apple token** — it only ever sees
   an Entra `v2.0` token, exactly like any other sign-in. Claims commonly surfaced to the app
   include `idp` (the federated IdP's identifier, e.g. `google.com` or the tenant's OIDC IdP
   GUID) and sometimes `idp_access_token`/`altsecid`-style claims if configured; the important
   invariant for our purposes is that **`iss` is always the Entra tenant issuer**, never
   `accounts.google.com`.

### 2.2 Key properties that matter for emulation

- **The relying-party app's contract never changes.** From the app/MSAL's point of view, it
  is talking to `/authorize`, `/token`, `/.well-known/openid-configuration`, and a JWKS, all on
  the Entra (or Entra Local) origin. Federation is entirely a server-side implementation
  detail of *how Entra completed the interactive sign-in step*, not a new client protocol
  surface.
- **Entra becomes a client of the external IdP**, i.e. it performs an outbound Authorization
  Code flow with its own registered `client_id`/`client_secret` against Google/Apple, then
  discards that token and mints a fresh, Entra-signed token.
- **JIT account linking** persists a mapping between `(issuer, subject)` and a local user
  object, so repeat sign-ins resolve to the same account.
- **Claims translation** happens once, at federation time, not per-token — the directory
  object is the source of truth after that.
- **This is orthogonal to the flows Entra Local already implements** (Auth Code+PKCE, Refresh
  Token, Client Credentials, Device Code): federation only changes *how the user is
  authenticated during the interactive step* of Authorization Code / Device Code; it does not
  change the token/grant contract at all.

## 3. Implications for Entra Local

### 3.1 What can be faithfully emulated offline

Everything **except** the actual outbound call to a real Google/Apple, because:

- The sandbox has **no real network access to Google/Apple's OAuth endpoints** by design (an
  offline emulator shouldn't require internet access, and doing so would leak the developer's
  test scenario to a third party and require real, working Google/Apple app registrations just
  to run a local dev loop).
- Real "Sign in with Google/Apple" also requires the *provider's own* registered
  `redirect_uri` to point back at a publicly resolvable, real Entra tenant (or, absent that, at
  the emulator's own local origin) — something a throwaway local dev tenant cannot obtain from
  Google/Apple's consoles in a way that is stable and CI-safe.

What **can** be emulated faithfully, and is the part of the feature developers actually need to
test:

1. **The app-facing contract is identical to real Entra** — `/authorize`, `/token`,
   discovery, JWKS, claims shape — so an app that adds "Sign in with Google" against real Entra
   needs zero code changes to work the same way against Entra Local.
2. **The federation *step itself* is a black box to the app** — so Entra Local can stand in
   for the external IdP with a **local, seeded, fake "Google"/"Apple"/"Contoso OIDC"
   provider** that presents its own simple "pretend sign-in" page (or reuses the existing
   account-picker, branded as the external IdP) instead of redirecting to the real provider.
   This preserves the *shape* of the flow (an extra hop, a provider-chosen identity, JIT
   linking, a distinct `idp` claim) without needing real network access or real provider
   credentials.
3. **JIT provisioning / claim shape** (`idp` claim, externally-sourced `email`/`name`, a
   linked user object) can be reproduced exactly, since this is Entra Local's own token
   service and store.

### 3.2 What is explicitly out of scope for a local emulator

- Real network calls to Google/Apple's actual OAuth/OIDC endpoints (defeats the "offline, no
  cloud dependency" goal that is the emulator's core value proposition — see
  `specs/global-spec.md` §1).
- SAML 2.0 / WS-Fed direct federation (already an explicit non-goal in `global-spec.md` §1 and
  independent of this investigation).
- The full **External ID for customers (CIAM)** product surface: separate `ciamlogin.com`
  tenant type, self-service sign-up user flows, page-layout customization (company branding
  editor), and multi-provider user-flow assignment UI. Reproducing "sign in with Google/Apple
  is possible" only needs the *federation mechanism*, not the CIAM product chrome.
- Apple-specific quirks that have no bearing on the emulated contract (e.g. Apple's
  `form_post` response mode, private relay emails, and its rotating client secret signed with
  an Apple-issued private key) — these only matter when *actually* talking to Apple, which is
  out of scope per above.

## 4. Options considered

| Option | Description | Verdict |
|---|---|---|
| **A. Proxy real Google/Apple** | Entra Local acts as a real OIDC client of Google/Apple, using developer-supplied real credentials, and requires network access. | Rejected — breaks the "offline/no cloud dependency" goal, needs the developer to own real Google/Apple app registrations just for local dev, and is unnecessary: the app under test never talks to Google/Apple directly, so faithfully reproducing *their* login UX has no test value. |
| **B. Simulated federated IdP(s), fully local** | Entra Local ships one or more seeded, fake external IdPs (e.g. `google.com`, `apple.com`, or a generic "Contoso OIDC" example) with their own mini sign-in step, wired into the existing `/authorize` flow exactly where a real federation redirect would occur. Entra Local plays both parties (RP and simulated IdP) but keeps the **claims contract** (`idp`, JIT-linked user, externally-sourced profile claims) faithful to real Entra. | **Recommended.** Matches the "emulate the scenario" ask, needs no network access or real credentials, and is a natural, additive extension of the existing account-picker/sign-in page (`src/identity/signinPage.ts`) and admin data model (`apps`/`users` in `src/store`). |
| **C. Do nothing / document only** | Ship only this report, no roadmap feature. | Viable near-term (this is an investigation spike, not a build request) but leaves the "eventually specifications.md" part of the issue unmet if stopped here. |

**Recommendation:** produce this report **and** a specifications document (Option B design),
but **do not** schedule implementation yet — file it as a new Deferred/backlog candidate on
`specs/roadmap.md` pending a maintainer decision on priority, consistent with how other
speculative features (e.g. OBO, multi-tenant) are tracked. See §5 of the specifications doc
for exit criteria that would promote it to a numbered roadmap feature.

## 5. Scope call for a future feature

If/when this is picked up, the recommended scope is **simulated OIDC federation** only:

- In scope: registering one or more fake external IdPs on an app registration, a
  "federated sign-in" step in the existing `/authorize` interactive flow, JIT
  user creation/linking, an `idp` claim on issued tokens, and admin/portal visibility into
  linked external identities.
- Out of scope (initially): real network calls to Google/Apple, SAML/WS-Fed, the CIAM
  tenant type / user flows / self-service sign-up, and per-provider quirks (Apple `form_post`,
  Google People API scopes, etc.) that only matter when talking to the real provider.

See the companion specifications document for the concrete design.

## 6. References

- Microsoft Learn: [External Identities documentation overview](https://learn.microsoft.com/en-us/entra/external-id/)
- Microsoft Learn: [Direct federation (SAML/WS-Fed) for External Identities](https://learn.microsoft.com/en-us/entra/external-id/direct-federation)
- Microsoft Learn: [Add Google as an identity provider (External ID for customers)](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-google-federation-customers)
- Microsoft Learn: [Add an identity provider to a user flow](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-add-identity-provider-to-user-flow-customers)
- Microsoft Learn: [OIDC claims mapping reference](https://learn.microsoft.com/en-us/entra/external-id/customers/reference-oidc-claims-mapping-customers)
- `specs/global-spec.md` §1 (Goals/Non-goals), §3 (Supported protocols/flows) — existing
  scope boundaries this investigation respects.
