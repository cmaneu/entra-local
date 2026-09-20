# OBO SPA + API sample

A runnable three-tier demonstration:

`@azure/msal-browser` SPA → confidential Express API → Entra Local Graph `/me`

The SPA obtains a delegated token for the middle tier. The API validates that token, passes it to
real `@azure/msal-node` `acquireTokenOnBehalfOf`, calls local Graph with the exchanged token, and
returns only the Graph profile plus safe claim summaries. Neither raw token is returned to the SPA.

> **Development only:** the fixed app secret below is public seed data for a local emulator. Never
> reuse it, these app IDs, or this configuration in production.

## Seeded registrations

| Tier | App ID | Type | Port / permission |
| --- | --- | --- | --- |
| SPA | `cccccccc-0000-0000-0000-000000000008` | Public | `http://localhost:5174` |
| Middle tier | `cccccccc-0000-0000-0000-000000000009` | Confidential | `api://…0009/access_as_user`, secret `obo-middle-tier-secret`, API on `4001` |
| Downstream | Microsoft Graph | Resource | delegated `User.Read` |

Expected transition:

- incoming: `aud=…0009`, `azp=…0008`, `scp=access_as_user`;
- downstream: `aud=https://graph.microsoft.com`, `azp/appid=…0009`, `scp=User.Read`;
- both tokens carry the selected user's same `oid`.

## Run

Prerequisites: Node 22.13+, the emulator built and running from the repository root, and its
self-signed certificate trusted by the browser and Node.

```bash
# terminal 1, repository root
pnpm install
pnpm build
PUBLIC_ORIGIN=https://localhost:8443 pnpm start

# terminal 2
cd samples/obo-spa-api
npm install
NODE_EXTRA_CA_CERTS=../../data/tls/cert.pem npm run dev
```

Open <http://localhost:5174>, sign in as a seeded user, then select **Call Graph via OBO**.

`NODE_EXTRA_CA_CERTS` must be set **before Node starts** so both `jose` JWKS retrieval and MSAL's
token request trust the emulator certificate. In the browser, visit <https://localhost:8443> once
and accept the development certificate warning (or install `data/tls/cert.pem` in the trust store).

## Configuration

Copy `api/.env.example` and `spa/.env.example` into your preferred environment loader, or export the
variables before running. Defaults are complete for the freshly seeded emulator:

- API: `PORT`, `EMULATOR_ORIGIN`, `TENANT_ID`, `API_CLIENT_ID`, `API_CLIENT_SECRET`,
  `INCOMING_SCOPE`, `DOWNSTREAM_SCOPE`, `SPA_ORIGIN`.
- SPA: `VITE_EMULATOR_ORIGIN`, `VITE_TENANT_ID`, `VITE_CLIENT_ID`, `VITE_API_APP_ID`,
  `VITE_REDIRECT_URI`, `VITE_API_BASE`, `VITE_API_SCOPE`.

The compatibility origin is intentional. When local-domain mode is enabled, start the emulator with
`PUBLIC_ORIGIN=https://localhost:8443` or adapt issuer/Graph origins separately.

## Endpoints and verification

- SPA: `http://localhost:5174`
- API health: `GET http://localhost:4001/health`
- Protected API: `GET http://localhost:4001/api/me`
- Token endpoint: `POST /{tenant}/oauth2/v2.0/token`
- Graph: `GET /graph/v1.0/me`

With all tiers running, execute `node smoke.mjs` from the repository root. It drives Playwright
sign-in, verifies the complete real-MSAL exchange and claim transition, checks Graph `/me`, and
asserts missing/invalid tokens return 401 while a valid wrong-scope token returns 403.

## Troubleshooting

- `SELF_SIGNED_CERT_IN_CHAIN`: set `NODE_EXTRA_CA_CERTS` to the emulator's `cert.pem`.
- discovery/issuer mismatch: restart the emulator with the localhost `PUBLIC_ORIGIN` shown above.
- `invalid_client`: reset/reseed the emulator and verify the fixed API secret.
- `invalid_grant`: verify the SPA token audience is the middle-tier app and has not expired.
