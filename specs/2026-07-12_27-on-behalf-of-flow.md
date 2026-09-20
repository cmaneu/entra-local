# Feature #27 — On-Behalf-Of flow

**Status:** ✅ Implemented

Support delegated SPA/client → confidential middle-tier API → downstream API/Graph exchange through
`POST /{tenant}/oauth2/v2.0/token`.

## Contract

- `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`
- `requested_token_use=on_behalf_of`
- `assertion=<delegated access token>`
- `scope=<one downstream resource's delegated scopes>`
- confidential client authentication through existing Basic or POST secret handling

The assertion must be signed by Entra Local, unexpired, from the configured tenant, delegated
(`oid` + non-empty `scp`, no app-only roles), and addressed to the authenticated middle-tier app.
The `oid` must resolve to an enabled local user. Requested scopes use existing registration/Graph
validation, must target one resource, and reject OIDC/grant-only requests and `.default`. OIDC
defaults automatically appended by MSAL Node are ignored and never emitted.

The exchanged token preserves `oid`, recalculates pairwise `sub` for the user and middle tier, sets
`azp`/`appid` to the middle-tier app, targets the downstream audience, and uses downstream resource
token configuration for optional/group claims. It has a fresh normal access-token lifetime,
delegated `client_info`, and no ID or refresh token. The assertion is never logged or persisted;
replay is allowed while it remains valid, enabling natural multi-hop OBO.

Errors use the existing AADSTS envelope and no-store headers: client authentication failures are
`invalid_client`; missing parameters/wrong token use are `invalid_request`; invalid assertions/users
are `invalid_grant`; invalid, mixed-resource, grant-only, or `.default` scopes are `invalid_scope`.

## Acceptance

Integration coverage verifies Graph and custom-API exchanges, JWKS verification, claim transition,
downstream optional/group claims, zero runtime-row writes, all error categories, and repeat exchange.
A real `@azure/msal-node` `acquireTokenOnBehalfOf` E2E test verifies compatibility.
