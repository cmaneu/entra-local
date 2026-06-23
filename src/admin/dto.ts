import type {
  AppRegistration,
  AppRole,
  AppScope,
  AppSecret,
  CreatedSecret,
  Group,
  RedirectUri,
  User,
} from '../store/types.js';

/** Convert stored epoch-seconds to an ISO-8601 string (or `null`). */
export function isoFromEpoch(epochSeconds: number | null): string | null {
  return epochSeconds == null ? null : new Date(epochSeconds * 1000).toISOString();
}

export interface UserDto {
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

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    userPrincipalName: user.userPrincipalName,
    displayName: user.displayName,
    givenName: user.givenName,
    surname: user.surname,
    mail: user.mail,
    accountEnabled: user.accountEnabled,
    hasPassword: user.hasPassword,
    createdAt: isoFromEpoch(user.createdAt) as string,
  };
}

export interface GroupDto {
  id: string;
  displayName: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

export function toGroupDto(group: Group, memberCount: number): GroupDto {
  return {
    id: group.id,
    displayName: group.displayName,
    description: group.description,
    memberCount,
    createdAt: isoFromEpoch(group.createdAt) as string,
  };
}

export interface RedirectUriDto {
  id: number;
  uri: string;
  type: string;
}

export function toRedirectUriDto(redirect: RedirectUri): RedirectUriDto {
  return { id: redirect.id, uri: redirect.uri, type: redirect.type };
}

export interface ScopeDto {
  id: string;
  value: string;
  adminConsentDisplayName: string | null;
  isEnabled: boolean;
}

export function toScopeDto(scope: AppScope): ScopeDto {
  return {
    id: scope.id,
    value: scope.value,
    adminConsentDisplayName: scope.adminConsentDisplayName,
    isEnabled: scope.isEnabled,
  };
}

export interface RoleDto {
  id: string;
  value: string;
  displayName: string | null;
  allowedMemberTypes: string[];
  isEnabled: boolean;
}

/** Split the stored comma-delimited `allowed_member_types` column into an array. */
export function parseAllowedMemberTypes(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function toRoleDto(role: AppRole): RoleDto {
  return {
    id: role.id,
    value: role.value,
    displayName: role.displayName,
    allowedMemberTypes: parseAllowedMemberTypes(role.allowedMemberTypes),
    isEnabled: role.isEnabled,
  };
}

export interface SecretDto {
  id: string;
  displayName: string | null;
  hint: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export function toSecretDto(secret: AppSecret): SecretDto {
  return {
    id: secret.id,
    displayName: secret.displayName,
    hint: secret.hint,
    expiresAt: isoFromEpoch(secret.expiresAt),
    createdAt: isoFromEpoch(secret.createdAt) as string,
  };
}

/** The show-once creation DTO — the ONLY response that ever contains `secretText`. */
export interface SecretCreatedDto extends SecretDto {
  secretText: string;
}

export function toSecretCreatedDto(secret: CreatedSecret): SecretCreatedDto {
  return { ...toSecretDto(secret), secretText: secret.plaintext };
}

export interface AppDto {
  id: string;
  displayName: string;
  isConfidential: boolean;
  appIdUri: string | null;
  redirectUris: RedirectUriDto[];
  exposedScopes: ScopeDto[];
  appRoles: RoleDto[];
  secrets: SecretDto[];
  createdAt: string;
}

export interface AppSubCollections {
  redirectUris: RedirectUri[];
  scopes: AppScope[];
  roles: AppRole[];
  secrets: AppSecret[];
}

export function toAppDto(app: AppRegistration, sub: AppSubCollections): AppDto {
  return {
    id: app.appId,
    displayName: app.displayName,
    isConfidential: app.isConfidential,
    appIdUri: app.appIdUri,
    redirectUris: sub.redirectUris.map(toRedirectUriDto),
    exposedScopes: sub.scopes.map(toScopeDto),
    appRoles: sub.roles.map(toRoleDto),
    secrets: sub.secrets.map(toSecretDto),
    createdAt: isoFromEpoch(app.createdAt) as string,
  };
}

export interface PagedResponse<T> {
  value: T[];
  count: number;
  top: number;
  skip: number;
}

export function toPaged<T>(value: T[], count: number, top: number, skip: number): PagedResponse<T> {
  return { value, count, top, skip };
}
