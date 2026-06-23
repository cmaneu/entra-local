/**
 * Domain types for the store layer. Repositories return these camelCase shapes (never raw rows
 * or password/secret hashes). `*at` fields are integer Unix epoch seconds.
 */

export interface Tenant {
  id: string;
  displayName: string;
  issuer: string;
  createdAt: number;
}

export interface User {
  id: string;
  tenantId: string;
  userPrincipalName: string;
  displayName: string;
  givenName: string | null;
  surname: string | null;
  mail: string | null;
  accountEnabled: boolean;
  /** Whether a password hash is set (the hash itself is never exposed). */
  hasPassword: boolean;
  createdAt: number;
}

export interface NewUser {
  /** Optional explicit id (== oid). Generated when omitted (admin/server-assigned ids). */
  id?: string;
  tenantId: string;
  userPrincipalName: string;
  displayName: string;
  givenName?: string | null;
  surname?: string | null;
  mail?: string | null;
  /** Plaintext password; hashed before storage. */
  password?: string | null;
  accountEnabled?: boolean;
}

export interface UserUpdate {
  userPrincipalName?: string;
  displayName?: string;
  givenName?: string | null;
  surname?: string | null;
  mail?: string | null;
  /** Plaintext password; hashed before storage. `null` clears the password. */
  password?: string | null;
  accountEnabled?: boolean;
}

export interface Group {
  id: string;
  tenantId: string;
  displayName: string;
  description: string | null;
  createdAt: number;
}

export interface NewGroup {
  id?: string;
  tenantId: string;
  displayName: string;
  description?: string | null;
}

export interface GroupUpdate {
  displayName?: string;
  description?: string | null;
}

export interface AppRegistration {
  appId: string;
  tenantId: string;
  displayName: string;
  isConfidential: boolean;
  appIdUri: string | null;
  createdAt: number;
}

export interface NewApp {
  appId?: string;
  tenantId: string;
  displayName: string;
  isConfidential?: boolean;
  appIdUri?: string | null;
}

export interface AppUpdate {
  displayName?: string;
  isConfidential?: boolean;
  appIdUri?: string | null;
}

export interface ScopeUpdate {
  adminConsentDisplayName?: string | null;
  isEnabled?: boolean;
}

export interface RoleUpdate {
  displayName?: string | null;
  allowedMemberTypes?: string;
  isEnabled?: boolean;
}

export interface RedirectUri {
  id: number;
  appId: string;
  uri: string;
  type: string;
}

/** App secret metadata. The hash is never exposed; the plaintext is returned only once on add. */
export interface AppSecret {
  id: string;
  appId: string;
  displayName: string | null;
  hint: string | null;
  expiresAt: number | null;
  createdAt: number;
}

export interface NewSecret {
  id?: string;
  displayName?: string | null;
  /** Plaintext secret; hashed before storage. */
  plaintext: string;
  expiresAt?: number | null;
}

/** A freshly created secret, including the one-time plaintext (never persisted). */
export interface CreatedSecret extends AppSecret {
  plaintext: string;
}

export interface AppScope {
  id: string;
  appId: string;
  value: string;
  adminConsentDisplayName: string | null;
  isEnabled: boolean;
}

export interface NewScope {
  id?: string;
  value: string;
  adminConsentDisplayName?: string | null;
  isEnabled?: boolean;
}

export interface AppRole {
  id: string;
  appId: string;
  value: string;
  displayName: string | null;
  allowedMemberTypes: string;
  isEnabled: boolean;
}

export interface NewRole {
  id?: string;
  value: string;
  displayName?: string | null;
  allowedMemberTypes?: string;
  isEnabled?: boolean;
}

export interface SigningKey {
  kid: string;
  tenantId: string;
  alg: string;
  publicJwk: string;
  privatePkcs8: string;
  isActive: boolean;
  createdAt: number;
  notAfter: number | null;
}

/** Public projection of a signing key (no private material) for JWKS in #3. */
export interface PublicSigningKey {
  kid: string;
  tenantId: string;
  alg: string;
  publicJwk: string;
  isActive: boolean;
  createdAt: number;
  notAfter: number | null;
}

export interface NewSigningKey {
  kid: string;
  tenantId: string;
  alg?: string;
  publicJwk: string;
  privatePkcs8: string;
  isActive?: boolean;
  notAfter?: number | null;
}

export interface AuthCode {
  code: string;
  appId: string;
  userId: string;
  redirectUri: string;
  scopes: string;
  resource: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  nonce: string | null;
  expiresAt: number;
  consumed: boolean;
  createdAt: number;
}

export interface NewAuthCode {
  code: string;
  appId: string;
  userId: string;
  redirectUri: string;
  scopes: string;
  resource?: string | null;
  codeChallenge?: string | null;
  codeChallengeMethod?: string | null;
  nonce?: string | null;
  expiresAt: number;
}

/** Refresh token row. The PK (`tokenHash`) is the SHA-256 of the opaque plaintext token. */
export interface RefreshToken {
  tokenHash: string;
  appId: string;
  userId: string;
  scopes: string;
  resource: string | null;
  expiresAt: number;
  rotatedFrom: string | null;
  revoked: boolean;
  createdAt: number;
}

export interface NewRefreshToken {
  /** Opaque plaintext token; stored hashed (SHA-256) as the PK. */
  token: string;
  appId: string;
  userId: string;
  scopes: string;
  resource?: string | null;
  expiresAt: number;
  /** Prior token hash in a rotation chain. */
  rotatedFrom?: string | null;
}

export interface Session {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface NewSession {
  id?: string;
  userId: string;
  expiresAt: number;
}
