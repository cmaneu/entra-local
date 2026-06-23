import type { Config } from '../config/schema.js';
import { TENANT_ENDPOINTS, USERINFO_PATH } from '../http/pathmap.js';

/**
 * OIDC discovery metadata + the canonical issuer / endpoint-URL derivation. This module owns the
 * single source of truth for:
 *  - the **always-GUID-form** `issuer` (`${PUBLIC_ORIGIN}/${TENANT_ID}/v2.0`), independent of the
 *    request alias (`common`/`organizations`/`consumers` all resolve to the concrete GUID), and
 *  - every advertised absolute endpoint URL, built from `PUBLIC_ORIGIN` + the shared path map.
 *
 * Feature #5 (token service) MUST import {@link buildIssuer} for its `iss` claim so the discovery
 * `issuer` and minted token `iss` are byte-identical (no independent re-derivation).
 */

/** The MSAL-tuned discovery document field set (Iteration 1 lockstep — see spec #4). */
export interface DiscoveryMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint: string;
  end_session_endpoint: string;
  response_types_supported: string[];
  response_modes_supported: string[];
  grant_types_supported: string[];
  subject_types_supported: string[];
  scopes_supported: string[];
  id_token_signing_alg_values_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  code_challenge_methods_supported: string[];
  claims_supported: string[];
}

/**
 * The canonical issuer for the configured tenant: always the GUID-form issuer
 * (`${PUBLIC_ORIGIN}/${TENANT_ID}/v2.0`, honoring an explicit `ISSUER` override), regardless of
 * which `{tenant}` alias was used in the request path. Exported as the single source of truth for
 * both the discovery document and #5's token `iss` claim.
 */
export function buildIssuer(config: Config): string {
  return config.issuer;
}

/** Build an absolute tenanted endpoint URL (always GUID-form) from `PUBLIC_ORIGIN`. */
function tenantUrl(config: Config, suffix: string): string {
  return `${config.publicOrigin}/${config.tenantId}/${suffix}`;
}

/**
 * Build the full MSAL-tuned discovery document. All URLs are absolute and GUID-form (identical for
 * every accepted alias). Iteration 1 lockstep: no `device_authorization_endpoint`, no device-code
 * grant, `response_modes_supported` exactly `["query","fragment"]`, no Microsoft cloud-host fields.
 */
export function buildDiscoveryMetadata(config: Config): DiscoveryMetadata {
  return {
    issuer: buildIssuer(config),
    authorization_endpoint: tenantUrl(config, TENANT_ENDPOINTS.authorize),
    token_endpoint: tenantUrl(config, TENANT_ENDPOINTS.token),
    jwks_uri: tenantUrl(config, TENANT_ENDPOINTS.jwks),
    userinfo_endpoint: `${config.publicOrigin}${USERINFO_PATH}`,
    end_session_endpoint: tenantUrl(config, TENANT_ENDPOINTS.logout),
    response_types_supported: ['code'],
    response_modes_supported: ['query', 'fragment'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    subject_types_supported: ['pairwise'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256', 'plain'],
    claims_supported: [
      'sub',
      'iss',
      'aud',
      'exp',
      'iat',
      'nbf',
      'tid',
      'oid',
      'name',
      'preferred_username',
      'email',
      'nonce',
      'ver',
    ],
  };
}
