/**
 * DTOs returned by the Admin REST API (#11), the `/health` endpoint (#1) and OIDC discovery (#4).
 * Field names bind exactly to the server's response shapes.
 */

export interface Health {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
  tls: boolean;
  tenantId: string;
  /** Advertised per-surface origins (#26). Collapsed configs report the same value for all three. */
  origins: { login: string; portal: string; graph: string };
}

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint: string;
  end_session_endpoint: string;
}

/**
 * Public metadata about the self-signed dev certificate clients must trust, returned by
 * `GET /admin/api/certificate`. `enabled: false` means TLS is off (no certificate to trust).
 */
export interface CertificateInfo {
  enabled: boolean;
  subject?: string;
  issuer?: string;
  fingerprintSha256?: string;
  thumbprintSha1?: string;
  serialNumber?: string;
  validFrom?: string;
  validTo?: string;
  fileName?: string;
  downloadPath?: string;
}

export interface Paged<T> {
  value: T[];
  count: number;
  top: number;
  skip: number;
}

export interface User {
  id: string;
  userPrincipalName: string;
  displayName: string;
  givenName: string | null;
  surname: string | null;
  mail: string | null;
  accountEnabled: boolean;
  hasPassword: boolean;
  createdAt: string;
}

export interface Group {
  id: string;
  displayName: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

export interface RedirectUri {
  id: number;
  uri: string;
  type: string;
}

export interface AppScope {
  id: string;
  value: string;
  adminConsentDisplayName: string | null;
  isEnabled: boolean;
}

export interface AppRole {
  id: string;
  value: string;
  displayName: string | null;
  allowedMemberTypes: string[];
  isEnabled: boolean;
}

export interface AppSecret {
  id: string;
  displayName: string | null;
  hint: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** The show-once secret-creation DTO — `secretText` is the plaintext, returned exactly once. */
export interface CreatedSecret extends AppSecret {
  secretText: string;
}

export interface App {
  id: string;
  displayName: string;
  isConfidential: boolean;
  appIdUri: string | null;
  redirectUris: RedirectUri[];
  exposedScopes: AppScope[];
  appRoles: AppRole[];
  secrets: AppSecret[];
  optionalClaims: OptionalClaimsConfig;
  groupMembershipClaims: GroupMembershipClaims;
  groupOverageLimit: number | null;
  createdAt: string;
}

/** A single configured optional claim (mirrors the Entra app-manifest shape). */
export interface OptionalClaim {
  name: string;
  essential: boolean;
}

/** Optional-claim collections supported by Entra Local (SAML is out of scope). */
export interface OptionalClaimsConfig {
  idToken: OptionalClaim[];
  accessToken: OptionalClaim[];
}

/** Which token collection an optional-claim set applies to. */
export type OptionalClaimKind = 'idToken' | 'accessToken';

/** Group-membership claim modes an app can be configured with. */
export type GroupMembershipClaims =
  | 'None'
  | 'SecurityGroup'
  | 'DirectoryRole'
  | 'ApplicationGroup'
  | 'All';

/** Metadata about which optional claims + group modes Entra Local supports. */
export interface SupportedClaims {
  idToken: string[];
  accessToken: string[];
  groupMembershipClaims: GroupMembershipClaims[];
  defaultGroupOverageLimit: number;
}

/** Decoded token-claims preview for a selected user + token type. */
export interface TokenPreview {
  tokenType: OptionalClaimKind;
  userId: string;
  claims: Record<string, unknown>;
  unsupportedClaims: string[];
  groupOverage: boolean;
}

/** Signed token generated for local development, with its decoded claims. */
export interface GeneratedToken extends TokenPreview {
  token: string;
}

/** A single field-level validation issue from the admin error envelope. */
export interface AdminFieldIssue {
  field: string;
  message: string;
}

export interface AdminErrorBody {
  error: {
    code: 'validation_error' | 'not_found' | 'conflict' | 'invalid_reference' | 'internal_error';
    message: string;
    target?: string;
    details?: AdminFieldIssue[];
  };
}
