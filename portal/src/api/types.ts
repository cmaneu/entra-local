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
}

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint: string;
  end_session_endpoint: string;
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
  createdAt: string;
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
