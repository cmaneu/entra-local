import type {
  AdminErrorBody,
  AdminFieldIssue,
  App,
  AppRole,
  AppScope,
  CertificateInfo,
  CreatedSecret,
  Discovery,
  Group,
  GroupMembershipClaims,
  Health,
  OptionalClaimKind,
  OptionalClaimsConfig,
  Paged,
  RedirectUri,
  SupportedClaims,
  TokenPreview,
  User,
} from './types';

/**
 * Error thrown for any non-2xx Admin API response. Carries the parsed admin error envelope so the
 * UI can surface `message`/`details` and map `409 conflict` / `400 validation_error` to inline
 * field errors.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: AdminErrorBody['error']['code'] | 'network_error' | 'unknown';
  readonly target?: string;
  readonly details: AdminFieldIssue[];

  constructor(
    status: number,
    code: ApiError['code'],
    message: string,
    options: { target?: string; details?: AdminFieldIssue[] } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (options.target !== undefined) this.target = options.target;
    this.details = options.details ?? [];
  }

  /** Whether this is a uniqueness conflict (e.g. duplicate UPN / redirect URI / scope value). */
  get isConflict(): boolean {
    return this.code === 'conflict';
  }

  /** Whether this is a request-validation failure (zod). */
  get isValidation(): boolean {
    return this.code === 'validation_error';
  }
}

type Query = Record<string, string | number | boolean | undefined>;

function buildPath(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'network_error', 'The admin API is unreachable (network error).');
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const parsed: unknown = text ? safeJson(text) : undefined;

  if (!res.ok) {
    const envelope = parsed as AdminErrorBody | undefined;
    if (envelope && envelope.error && typeof envelope.error.message === 'string') {
      throw new ApiError(res.status, envelope.error.code, envelope.error.message, {
        ...(envelope.error.target !== undefined ? { target: envelope.error.target } : {}),
        ...(envelope.error.details !== undefined ? { details: envelope.error.details } : {}),
      });
    }
    throw new ApiError(res.status, 'unknown', `Request failed (HTTP ${res.status}).`);
  }

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const ADMIN = '/admin/api';

/** Typed client for the Admin REST API, `/health`, and OIDC discovery. */
export const api = {
  // ---- system ----
  health: () => request<Health>('GET', '/health'),
  discovery: (tenantId: string, base = '') =>
    request<Discovery>('GET', `${base}/${tenantId}/v2.0/.well-known/openid-configuration`),
  certificate: () => request<CertificateInfo>('GET', `${ADMIN}/certificate`),
  seed: () => request<{ seeded: boolean }>('POST', `${ADMIN}/seed`, { force: true }),
  reset: () =>
    request<{ reset: true; reseeded: boolean }>('POST', `${ADMIN}/reset`, { reseed: true }),

  // ---- users ----
  listUsers: (q: { top?: number; skip?: number; search?: string } = {}) =>
    request<Paged<User>>('GET', buildPath(`${ADMIN}/users`, q)),
  getUser: (id: string) => request<User>('GET', `${ADMIN}/users/${id}`),
  createUser: (body: UserBody) => request<User>('POST', `${ADMIN}/users`, body),
  updateUser: (id: string, body: Partial<UserBody>) =>
    request<User>('PATCH', `${ADMIN}/users/${id}`, body),
  deleteUser: (id: string) => request<void>('DELETE', `${ADMIN}/users/${id}`),
  userGroups: (id: string) => request<Paged<Group>>('GET', `${ADMIN}/users/${id}/groups`),

  // ---- groups ----
  listGroups: (q: { top?: number; skip?: number; search?: string } = {}) =>
    request<Paged<Group>>('GET', buildPath(`${ADMIN}/groups`, q)),
  createGroup: (body: GroupBody) => request<Group>('POST', `${ADMIN}/groups`, body),
  updateGroup: (id: string, body: Partial<GroupBody>) =>
    request<Group>('PATCH', `${ADMIN}/groups/${id}`, body),
  deleteGroup: (id: string) => request<void>('DELETE', `${ADMIN}/groups/${id}`),
  groupMembers: (id: string) => request<Paged<User>>('GET', `${ADMIN}/groups/${id}/members`),
  addMember: (id: string, userId: string) =>
    request<void>('POST', `${ADMIN}/groups/${id}/members`, { userId }),
  removeMember: (id: string, userId: string) =>
    request<void>('DELETE', `${ADMIN}/groups/${id}/members/${userId}`),

  // ---- apps ----
  listApps: (q: { top?: number; skip?: number; search?: string } = {}) =>
    request<Paged<App>>('GET', buildPath(`${ADMIN}/apps`, q)),
  getApp: (id: string) => request<App>('GET', `${ADMIN}/apps/${id}`),
  createApp: (body: AppBody) => request<App>('POST', `${ADMIN}/apps`, body),
  updateApp: (id: string, body: Partial<AppBody>) =>
    request<App>('PATCH', `${ADMIN}/apps/${id}`, body),
  deleteApp: (id: string) => request<void>('DELETE', `${ADMIN}/apps/${id}`),

  addRedirectUri: (id: string, body: { uri: string; type: string }) =>
    request<RedirectUri>('POST', `${ADMIN}/apps/${id}/redirectUris`, body),
  removeRedirectUri: (id: string, uriId: number) =>
    request<void>('DELETE', `${ADMIN}/apps/${id}/redirectUris/${uriId}`),

  createSecret: (id: string, body: { displayName?: string; expiresInDays?: number }) =>
    request<CreatedSecret>('POST', `${ADMIN}/apps/${id}/secrets`, body),
  deleteSecret: (id: string, secretId: string) =>
    request<void>('DELETE', `${ADMIN}/apps/${id}/secrets/${secretId}`),

  addScope: (id: string, body: { value: string; adminConsentDisplayName?: string }) =>
    request<AppScope>('POST', `${ADMIN}/apps/${id}/scopes`, body),
  updateScope: (id: string, scopeId: string, body: { isEnabled?: boolean }) =>
    request<AppScope>('PATCH', `${ADMIN}/apps/${id}/scopes/${scopeId}`, body),
  removeScope: (id: string, scopeId: string) =>
    request<void>('DELETE', `${ADMIN}/apps/${id}/scopes/${scopeId}`),

  addRole: (id: string, body: { value: string; displayName?: string }) =>
    request<AppRole>('POST', `${ADMIN}/apps/${id}/roles`, body),
  updateRole: (id: string, roleId: string, body: { isEnabled?: boolean }) =>
    request<AppRole>('PATCH', `${ADMIN}/apps/${id}/roles/${roleId}`, body),
  removeRole: (id: string, roleId: string) =>
    request<void>('DELETE', `${ADMIN}/apps/${id}/roles/${roleId}`),

  // ---- token configuration ----
  supportedClaims: () =>
    request<SupportedClaims>('GET', `${ADMIN}/token-configuration/supported-claims`),
  updateTokenConfig: (id: string, body: TokenConfigBody) =>
    request<App>('PATCH', `${ADMIN}/apps/${id}`, body),
  tokenPreview: (id: string, body: { userId: string; tokenType: OptionalClaimKind }) =>
    request<TokenPreview>('POST', `${ADMIN}/apps/${id}/token-preview`, body),
};

/** Patch body for an app's token configuration (optional claims + group claims). */
export interface TokenConfigBody {
  optionalClaims?: OptionalClaimsConfig;
  groupMembershipClaims?: GroupMembershipClaims;
  groupOverageLimit?: number | null;
}

export interface UserBody {
  userPrincipalName: string;
  displayName: string;
  givenName?: string | null;
  surname?: string | null;
  mail?: string | null;
  accountEnabled?: boolean;
  password?: string | null;
}

export interface GroupBody {
  displayName: string;
  description?: string | null;
}

export interface AppBody {
  displayName: string;
  isConfidential?: boolean;
  appIdUri?: string | null;
}
