# Feature #4 — OIDC Discovery Document

- **Roadmap ref:** Iteration 1, feature #4 ("OIDC discovery document").
- **Dependencies:** [#1](2026-06-22_01-server-config-tls-foundation.md) (server, path map, config), [#3](2026-06-22_03-signing-keys-jwks.md) (JWKS endpoint advertised).
- **Status:** ⬜ Not started.

> **Canonical-reference notice.** This spec owns the discovery document field set **and** the canonical `{tenant}` alias-normalization rule used by every `/{tenant}/...` endpoint (#3/#6/#7/#8/#9/#15). It also owns the `issuer`/endpoint-URL derivation consumed by [#5](2026-06-22_05-token-service.md) (`iss` claim) and MSAL auto-config.

---

## Goal / outcome

A standards-correct, MSAL-tuned OIDC discovery document at `/{tenant}/v2.0/.well-known/openid-configuration` that drives MSAL auto-configuration. It advertises **only endpoints that exist in the current iteration** (lockstep rule), exposes the issuer/JWKS/authorize/token/userinfo/logout URLs built from the configured origin, and lists supported scopes, response/grant types, claims, and signing algorithms exactly as MSAL expects.

---

## Scope

### In scope
- `GET /{tenant}/v2.0/.well-known/openid-configuration` returning the full discovery JSON.
- Canonical `{tenant}` alias-normalization rule (GUID + `common`/`organizations`/`consumers`).
- `issuer` derivation and the `{tenantid}` semantics in the issuer string for alias requests.
- Endpoint-URL builder from `PUBLIC_ORIGIN`/`ISSUER` config ([#1](2026-06-22_01-server-config-tls-foundation.md)).
- Lockstep advertising: include `device_authorization_endpoint` only when #15 lands (Iteration 2); in Iteration 1 it is **omitted**.
- Cross-platform field concerns flagged to #13.

### Out of scope
- The endpoints themselves (owned by #3/#6/#7/#8/#9).
- `webfinger`/issuer-discovery (`/.well-known/webfinger`) — not used by MSAL custom authorities.
- Tenanted metadata caching headers tuning beyond a sane default.

---

## Contracts

### Endpoint
| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/{tenant}/v2.0/.well-known/openid-configuration` | none | `200 application/json` discovery metadata |

`Cache-Control: public, max-age=3600`. `Content-Type: application/json`.

### Tenant alias normalization (canonical rule)
- Allowlist: the configured `TENANT_ID` GUID + literal `common`, `organizations`, `consumers`. Any other segment → `404` (discovery/JWKS) or OAuth `400 invalid_request` (token/authorize, owned by #6).
- **Internal routing:** all aliases resolve to the single seeded tenant.
- **`issuer` value:** ALWAYS the GUID-form issuer `${PUBLIC_ORIGIN}/${TENANT_ID}/v2.0`, regardless of which alias was used in the request path. This mirrors Entra: requesting `/common` returns an issuer containing the concrete tenant id (the `{tenantid}` placeholder is resolved to the real GUID for a single-tenant emulator). Consequently, **all issued tokens carry the GUID issuer** and MSAL's issuer validation succeeds when configured with the GUID authority. (Documented divergence: real Entra `/common` returns a templated `{tenantid}` issuer that MSAL resolves per-token; for a single fixed tenant we return the concrete GUID, which is simpler and still MSAL-valid. Flagged to #13 for MSAL.NET/Python issuer-validation confirmation.)

### Discovery document field set (MSAL-tuned)
```jsonc
{
  "issuer": "https://localhost:8443/11111111-1111-1111-1111-111111111111/v2.0",
  "authorization_endpoint": "https://localhost:8443/11111111-1111-1111-1111-111111111111/oauth2/v2.0/authorize",
  "token_endpoint": "https://localhost:8443/11111111-1111-1111-1111-111111111111/oauth2/v2.0/token",
  "jwks_uri": "https://localhost:8443/11111111-1111-1111-1111-111111111111/discovery/v2.0/keys",
  "userinfo_endpoint": "https://localhost:8443/graph/oidc/userinfo",
  "end_session_endpoint": "https://localhost:8443/11111111-1111-1111-1111-111111111111/oauth2/v2.0/logout",
  "response_types_supported": ["code"],
  "response_modes_supported": ["query", "fragment"],
  "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials"],
  "subject_types_supported": ["pairwise"],
  "scopes_supported": ["openid", "profile", "email", "offline_access"],
  "id_token_signing_alg_values_supported": ["RS256"],
  "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"],
  "code_challenge_methods_supported": ["S256", "plain"],
  "claims_supported": [
    "sub", "iss", "aud", "exp", "iat", "nbf", "tid", "oid",
    "name", "preferred_username", "email", "nonce", "ver"
  ]
}
```
**Notes / rationale per field:**
- `userinfo_endpoint` → `/graph/oidc/userinfo` per the locked single-origin path map (not the draft global-spec `/{tenant}/openid/userinfo`).
- `subject_types_supported: ["pairwise"]` matches Entra v2.
- `token_endpoint_auth_methods_supported` lists both `client_secret_post` and `client_secret_basic` (#6/#8 accept both).
- `grant_types_supported` lists only flows implemented in Iteration 1; **`urn:ietf:params:oauth:grant-type:device_code` is added by #15** (lockstep).
- `device_authorization_endpoint` is **omitted** in Iteration 1; added by #15.
- `http_logout_supported`/`frontchannel_logout_supported` may be added by #9 if its logout implementation warrants; #4 reserves the slot but #9 owns the value.
- `response_modes_supported` is `["query","fragment"]` in Iteration 1 — exactly the modes #6 implements. `form_post` is added **only if/when** #6 implements it (lockstep). Do not advertise `form_post` in Iteration 1.

### Config consumed
`PUBLIC_ORIGIN`, `ISSUER`, `TENANT_ID` ([#1](2026-06-22_01-server-config-tls-foundation.md)). The endpoint URLs are derived from `PUBLIC_ORIGIN` + the canonical path map; `issuer` from `ISSUER` (default derived).

---

## Behavior / flow
1. Validate/normalize `{tenant}` (canonical rule above). Invalid → `404`.
2. Build the document from config-derived origin + path map constants + the **lockstep endpoint set** (only registered endpoints for the current iteration).
3. Return JSON with cache headers.

The endpoint list is assembled from a single source shared with the router (the canonical path map in [#1](2026-06-22_01-server-config-tls-foundation.md)). Per #1's **Reserved-stub rule**, every advertised endpoint already resolves to a registered route (a `501` stub before its owning feature lands, a real handler after) — so the "advertised URL maps to a registered route" boot-time assertion always holds and there are never advertised bare-`404`s. #4 advertises only the **iteration-appropriate** endpoint set (e.g. no `device_authorization_endpoint` until #15).

---

## Data changes
None.

---

## Dependencies & assumptions
- **Assumption:** MSAL.js with `protocolMode: 'OIDC'` (or default with `knownAuthorities`) consumes this document; cross-platform MSAL.NET/Python validation is feature #13's job. Concerns flagged below.
- **Assumption:** returning the concrete GUID issuer for alias requests is acceptable for single-tenant MSAL validation.

### Cross-platform field concerns flagged to #13
- **Issuer templating:** real Entra `/common` issuer uses `{tenantid}`; we return the concrete GUID. Confirm MSAL.NET/Python accept this for the GUID authority (they typically do; `/common` + alias validation is the risk).
- **`tenant_region_scope`, `cloud_instance_name`, `cloud_graph_host_name`, `msgraph_host`, `rbac_url`** — Entra includes Microsoft-specific fields. MSAL.js ignores unknown fields; MSAL.NET/Python instance discovery may probe `https://login.microsoftonline.com/common/discovery/instance`. #13 documents `knownAuthorities`/`protocolMode`/`instance_discovery=false` per platform to bypass instance discovery. #4 does **not** add these Microsoft-host fields (they'd point at real cloud hosts).
- **`device_authorization_endpoint`/device grant** appear only after #15.

---

## Testable acceptance criteria
1. **Document shape (integration via inject):** `GET /{tenant}/v2.0/.well-known/openid-configuration` → `200` with all required fields above; `issuer`, `authorization_endpoint`, `token_endpoint`, `jwks_uri`, `userinfo_endpoint`, `end_session_endpoint` are absolute URLs built from `PUBLIC_ORIGIN`.
2. **Issuer = token iss (token-conformance):** the discovery `issuer` exactly equals the `iss` claim minted by [#5](2026-06-22_05-token-service.md).
3. **Alias issuer (integration):** requesting via `common`/`organizations`/`consumers`/GUID all return the **same** GUID-form `issuer` and identical endpoint URLs.
4. **Invalid tenant (integration):** an unknown `{tenant}` segment → `404` JSON (not SPA HTML).
5. **Lockstep (integration):** `grant_types_supported` excludes the device-code grant and `device_authorization_endpoint` is absent in Iteration 1; every advertised endpoint URL resolves to a registered route (a `501` stub or real handler per #1's Reserved-stub rule — never a bare `404`/SPA); `response_modes_supported` is exactly `["query","fragment"]`.
6. **JWKS link (integration):** `jwks_uri` equals the live JWKS path from [#3](2026-06-22_03-signing-keys-jwks.md) and fetching it returns a JWK Set.
7. **MSAL auto-config (e2e):** an `@azure/msal-node`/`@azure/msal-browser` client configured with `authority=<origin>/{tenant}` + `knownAuthorities` successfully fetches and parses this document (asserted as part of #6's e2e once authorize/token exist; #4 alone asserts the fetch+parse succeeds).
8. **Cache headers (integration):** response sets `Cache-Control: public, max-age=3600`.

---

## Open questions
None blocking. *(Decision: concrete-GUID issuer for all aliases; omit Microsoft cloud-host fields; advertise `["query","fragment"]` response modes in Iteration 1, adding `form_post` only if #6 implements it. Cross-platform MSAL.NET/Python issuer + instance-discovery handling is owned by #13.)*
