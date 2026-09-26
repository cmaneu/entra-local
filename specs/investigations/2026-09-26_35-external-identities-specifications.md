# Draft Specification — Simulated External Identity Federation (Google/Apple-style SSO)

- **Status:** 📝 Draft / not scheduled. This is the specification deliverable requested by the
  investigation spike [#35](https://github.com/cmaneu/entra-local/issues/35); it is **not**
  assigned a roadmap feature number yet. See the companion
  [report](./2026-09-26_35-external-identities-report.md) for the research behind these
  decisions, and `specs/roadmap.md` (Deferred section) for how this is tracked until
  scheduled.
- **Roadmap ref:** none yet — candidate for a future iteration, gated on maintainer
  prioritization (see §7 Exit criteria).
- **Dependencies (if scheduled):** #6 (Auth Code + PKCE + interactive sign-in — this feature
  extends the same `/authorize` interaction and sign-in page), #11 (Admin REST API), #12 (Web
  portal).

---

## Goal / outcome

A developer can configure an app registration in Entra Local so that its sign-in page offers
one or more **simulated federated identity providers** (e.g. "Continue with Google",
"Continue with Apple", or a generic "Continue with Contoso") in addition to (or instead of)
the existing seeded-user account picker. Choosing one walks through a locally-simulated
federation hop — mirroring the extra redirect real Entra performs to the real external IdP —
and results in a normal, Entra-local-issued, JWKS-verifiable token whose claims reflect a
**just-in-time (JIT) provisioned** identity, exactly like real Entra External Identities. No
real network call to Google/Apple/any third party is ever made — see the investigation report
§3.2 for why this is intentionally out of scope.

---

## Scope

### In scope
- A new **Identity Providers** admin concept: seeded/admin-managed fake external IdPs
  (`id`, `displayName`, `protocol: "oidc"`, a stable `idp` claim value such as `google.com` /
  `apple.com` / a custom domain, and an icon/label for the UI).
- Associating one or more identity providers with an app registration (which federated options
  appear on that app's sign-in page) — mirrors real Entra's "assign IdP to a user flow /
  app", simplified to a direct app-to-IdP association since Entra Local has no CIAM user-flow
  concept.
- Extending `/authorize`'s interactive step (`src/identity/signinPage.ts`,
  `src/identity/authorize.ts`) to render the configured federated options alongside the
  existing account picker.
- A **simulated federation hop**: selecting a federated option takes the user to a second,
  clearly-labeled local page ("You're signing in to `<app>` via `<idp>` — this is simulated by
  Entra Local") where they either pick from a small set of fake external profiles or type an
  email — no real redirect, no real network call.
- **JIT provisioning**: first sign-in via a given `(idpId, externalSubject)` pair creates a
  linked local user record; subsequent sign-ins resolve to the same record (parity with real
  Entra's account-linking behavior).
- Token claim additions: `idp` claim set to the provider's configured value on tokens issued
  through a federated sign-in (omitted entirely for normal seeded-user sign-in, matching real
  Entra, which only emits `idp` for federated/guest accounts).
- Admin REST API + portal surfacing: CRUD for identity providers, associating them with apps,
  and listing JIT-provisioned users with their linked `(idp, externalSubject)` alongside
  regular seeded users.
- Documentation of the simulation boundary (README/spec callout: "this does not call Google or
  Apple; it simulates the *shape* of federation for local testing").

### Out of scope (explicitly, and why)
- Real OIDC/OAuth calls to Google, Apple, Facebook, or any other real provider (see report
  §3.2 — breaks the offline/no-cloud-dependency goal; also each real provider requires its own
  redirect URI registration that a throwaway local tool cannot obtain reliably).
- SAML 2.0 / WS-Fed direct federation (already out of scope per `global-spec.md` §1).
- The **External ID for customers (CIAM)** product surface: a separate `ciamlogin.com`-style
  tenant type, self-service sign-up user flows, and the company-branding page editor. Entra
  Local stays a single workforce-style tenant; federated IdPs are attached directly to apps.
- Provider-specific quirks that only matter when talking to a real provider (Apple's
  `form_post` response mode / rotating client secret, Google's People API scopes, consent
  screens).
- Any change to the non-interactive grants (client credentials, refresh token, device code
  polling) — federation only touches the **interactive** step of Authorization Code (and,
  optionally, Device Code's browser-side approval page), not the token contract.

---

## Data model changes (if scheduled)

New store concepts (illustrative — final shape decided at implementation time, following the
existing `src/store/repositories` + migration pattern):

```
identity_providers
  id                 text primary key (e.g. "idp-google")
  display_name       text            -- "Google"
  idp_claim_value    text            -- "google.com" (emitted as the `idp` token claim)
  protocol           text            -- "oidc" (reserved for future "saml")
  enabled            integer         -- 0/1

app_identity_providers   -- join table: which apps offer which IdPs on sign-in
  app_id             text references apps(app_id)
  identity_provider_id text references identity_providers(id)

federated_identities     -- JIT-linked external identities
  id                     text primary key
  identity_provider_id   text references identity_providers(id)
  external_subject       text    -- the simulated external "sub"
  user_id                text references users(id)  -- the linked local user
  email                  text
  created_at             text
  unique(identity_provider_id, external_subject)
```

Seed data would ship 1-2 example providers (`google.com`, `apple.com`) disabled by default, so
existing seeded-user flows are unaffected unless a developer opts an app into federation.

---

## Contracts (if scheduled)

### Sign-in page
`GET|POST /{tenant}/oauth2/v2.0/authorize` (existing endpoint, extended):
- When the requesting app has one or more enabled identity providers associated, the rendered
  sign-in page adds a "Continue with `<displayName>`" button per provider above/alongside the
  existing account picker, per the existing `signinPage.ts` conventions (inline-styled,
  framework-free, DESIGN.md tokens).
- Submitting a federated option starts a **new, emulator-internal** interaction (not a redirect
  off-origin): a `GET /{tenant}/federation/{idpId}/simulate?state=...` page listing 1-2 example
  fake profiles for that provider (e.g. `alice@gmail.example` / `bob@gmail.example`) plus a
  free-text email field, all clearly labeled as simulated. This reuses the existing signed
  `__el_state` mechanism from `signinPage.ts` to resume the original `/authorize` request.
- On submission, the emulator performs JIT lookup/creation against `federated_identities`,
  establishes the same emulator session cookie interactive sign-in already sets, and resumes
  the authorize flow exactly where the account picker's submit handler does today (issuing a
  code, redirecting to `redirect_uri`).

### Token claims
- ID/access tokens issued for a session established via a federated identity provider include
  `idp: "<idp_claim_value>"` (e.g. `"google.com"`), matching real Entra's behavior of
  surfacing the source IdP for externally-authenticated users. Tokens for normal seeded-user
  sign-in continue to omit `idp` entirely, preserving current token-shape parity (per the
  existing "token preview must match issuance" convention — token preview and generation share
  claim assembly, see `src/tokens/service.ts`).
- No other claim contracts change; `iss`/`aud`/`tid` continue to be the emulator's own tenant
  issuer per the existing `buildIssuer(config)` convention — federation never changes who
  signs/issues the token.

### Admin REST API
- `GET/POST /admin/api/identity-providers`, `PATCH/DELETE /admin/api/identity-providers/{id}`
  — CRUD, following the existing `routes.apps.ts`-style conventions (zod validation via
  `schemas.ts`, DTOs in `dto.ts`).
- `PUT /admin/api/apps/{appId}/identity-providers` — set the list of enabled IdPs for an app.
- `GET /admin/api/identity-providers/{id}/federated-users` — list JIT-provisioned identities
  (for portal visibility / debugging / reset).
- `reset`/`seed` continue to clear `federated_identities` along with other per-run state, per
  the existing determinism convention (fixed seed, ephemeral DB).

### Web portal
- App registration detail page gains an "Identity providers" section (checkboxes/toggles for
  the seeded providers) alongside the existing MSAL config snippet.
- A new "Federated identities" list (under Users, or its own section) showing
  `idp / external subject / linked user / created at`, mirroring the existing Users list
  styling.

---

## Testing & acceptance criteria (if scheduled)

Per the existing Definition of Done (`specs/roadmap.md`, `memory/conventions.md`):
1. Unit tests for identity-provider repository CRUD and JIT-linking logic (first sign-in
   creates a `federated_identities` row + `users` row; repeat sign-in with the same
   `(idpId, externalSubject)` reuses the same `users` row).
2. Integration tests: `/admin/api/identity-providers` CRUD; `/authorize` rendering the
   federated options when configured; the simulate-and-resume round trip ending in a valid
   authorization code.
3. Token-conformance test: a token minted via federated sign-in carries `idp` and validates
   against JWKS exactly like any other token; a token from normal seeded sign-in has no `idp`
   claim (regression guard for the existing claim-assembly convention).
4. An e2e test extends the existing real-MSAL Authorization Code + PKCE harness
   (`test/e2e`) to drive the federated path through a real `msal-browser`/`msal-node` client,
   asserting the resulting ID token's `idp` claim — proving the app-facing contract truly
   never changes.
5. No changes required to non-interactive grants' tests (client credentials, refresh, device
   code polling) — confirms the "orthogonal to existing flows" claim in the investigation
   report.

---

## Open questions (to resolve before scheduling)

| Question | Notes |
|---|---|
| Should the federated "IdP picker" be a distinct page, or an extra section within the existing account-picker page? | Distinct page more faithfully mirrors the real "extra redirect" UX developers will see against real Entra; a merged page is simpler to implement. Recommend distinct page for fidelity. |
| Do we need >1 example fake provider out of the box, or is a single generic "Simulated OIDC IdP" enough, with `google.com`/`apple.com` just being named presets over the same mechanism? | Recommend the latter — one mechanism, a couple of named presets — to avoid maintaining protocol-specific quirks for providers we never actually call. |
| Does Device Code's approval page need the same treatment? | Lower priority; Authorization Code is the primary interactive flow and where real Entra's federation UX actually appears. |
| Naming: "Identity Providers" vs. "External Identities" in the admin/portal UI | Prefer "Identity providers" to match Entra's own admin-center terminology and avoid confusion with B2B guest concepts, which are out of scope. |

---

## Exit criteria to promote this to a numbered roadmap feature

- A maintainer decision to prioritize it (currently tracked under `specs/roadmap.md`
  Deferred).
- Confirmation that the simulation-only scope (§ In scope / Out of scope above) is acceptable
  — i.e., that developers get value from testing the federated-claims *shape* without a real
  Google/Apple round trip.
- A concrete spec file `specs/<yyyy-mm-dd>_<feature-number>-external-identities.md` created
  from this draft once scheduled, following the standard per-feature spec format.
