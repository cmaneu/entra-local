import { randomUUID } from 'node:crypto';
import type { Database } from '../db.js';
import { hashSecret, verifySecret } from '../hashing.js';
import type {
  AppRegistration,
  AppRole,
  AppScope,
  AppSecret,
  AppUpdate,
  CreatedSecret,
  GroupMembershipClaims,
  NewApp,
  NewRole,
  NewScope,
  NewSecret,
  OptionalClaimsConfig,
  RedirectUri,
  RoleUpdate,
  ScopeUpdate,
} from '../types.js';
import { GROUP_MEMBERSHIP_CLAIMS_VALUES } from '../types.js';
import type { Clock, Row } from '../util.js';
import { asBool, escapeLike, fromBool, optNum, optStr, reqNum, reqStr } from '../util.js';
import type { ListOptions } from './users.js';

/** An empty (no-claims) optional-claims configuration. */
function emptyOptionalClaims(): OptionalClaimsConfig {
  return { idToken: [], accessToken: [] };
}

/** Parse the stored `optional_claims` JSON blob into a normalized {@link OptionalClaimsConfig}. */
function parseOptionalClaims(raw: string | null): OptionalClaimsConfig {
  if (raw == null || raw.trim() === '') return emptyOptionalClaims();
  try {
    const parsed = JSON.parse(raw) as Partial<OptionalClaimsConfig>;
    return {
      idToken: Array.isArray(parsed.idToken) ? parsed.idToken : [],
      accessToken: Array.isArray(parsed.accessToken) ? parsed.accessToken : [],
    };
  } catch {
    return emptyOptionalClaims();
  }
}

/** Serialize an optional-claims configuration for storage (`null` when there are no entries). */
function serializeOptionalClaims(config: OptionalClaimsConfig | undefined): string | null {
  if (!config) return null;
  const idToken = config.idToken ?? [];
  const accessToken = config.accessToken ?? [];
  if (idToken.length === 0 && accessToken.length === 0) return null;
  return JSON.stringify({ idToken, accessToken });
}

/** Coerce a stored/raw value into a valid {@link GroupMembershipClaims} (defaults to `None`). */
function normalizeGroupClaims(raw: string | null): GroupMembershipClaims {
  return (GROUP_MEMBERSHIP_CLAIMS_VALUES as readonly string[]).includes(raw ?? '')
    ? (raw as GroupMembershipClaims)
    : 'None';
}

function mapApp(row: Row): AppRegistration {
  return {
    appId: reqStr(row, 'app_id'),
    tenantId: reqStr(row, 'tenant_id'),
    displayName: reqStr(row, 'display_name'),
    isConfidential: asBool(row, 'is_confidential'),
    appIdUri: optStr(row, 'app_id_uri'),
    optionalClaims: parseOptionalClaims(optStr(row, 'optional_claims')),
    groupMembershipClaims: normalizeGroupClaims(optStr(row, 'group_membership_claims')),
    groupOverageLimit: optNum(row, 'group_overage_limit'),
    createdAt: reqNum(row, 'created_at'),
  };
}

function mapRedirectUri(row: Row): RedirectUri {
  return {
    id: reqNum(row, 'id'),
    appId: reqStr(row, 'app_id'),
    uri: reqStr(row, 'uri'),
    type: reqStr(row, 'type'),
  };
}

function mapSecret(row: Row): AppSecret {
  return {
    id: reqStr(row, 'id'),
    appId: reqStr(row, 'app_id'),
    displayName: optStr(row, 'display_name'),
    hint: optStr(row, 'hint'),
    expiresAt: optNum(row, 'expires_at'),
    createdAt: reqNum(row, 'created_at'),
  };
}

function mapScope(row: Row): AppScope {
  return {
    id: reqStr(row, 'id'),
    appId: reqStr(row, 'app_id'),
    value: reqStr(row, 'value'),
    adminConsentDisplayName: optStr(row, 'admin_consent_display_name'),
    isEnabled: asBool(row, 'is_enabled'),
  };
}

function mapRole(row: Row): AppRole {
  return {
    id: reqStr(row, 'id'),
    appId: reqStr(row, 'app_id'),
    value: reqStr(row, 'value'),
    displayName: optStr(row, 'display_name'),
    allowedMemberTypes: reqStr(row, 'allowed_member_types'),
    isEnabled: asBool(row, 'is_enabled'),
  };
}

/** Derive a portal-display hint (first/last few chars) for a secret plaintext. */
function secretHint(plaintext: string): string {
  if (plaintext.length <= 6) return `${plaintext.slice(0, 1)}…`;
  return `${plaintext.slice(0, 3)}…${plaintext.slice(-2)}`;
}

export interface AppsRepository {
  getByAppId(appId: string): AppRegistration | undefined;
  getByAppIdUri(appIdUri: string): AppRegistration | undefined;
  list(options?: ListOptions): AppRegistration[];
  count(options?: ListOptions): number;
  create(input: NewApp): AppRegistration;
  update(appId: string, patch: AppUpdate): AppRegistration | undefined;
  delete(appId: string): boolean;

  addRedirectUri(appId: string, uri: string, type?: string): RedirectUri;
  listRedirectUris(appId: string): RedirectUri[];
  removeRedirectUri(appId: string, uri: string): boolean;
  removeRedirectUriById(appId: string, id: number): boolean;

  addSecret(appId: string, input: NewSecret): CreatedSecret;
  listSecrets(appId: string): AppSecret[];
  removeSecret(appId: string, secretId: string): boolean;
  verifySecret(appId: string, plaintext: string): boolean;

  addScope(appId: string, input: NewScope): AppScope;
  listScopes(appId: string): AppScope[];
  updateScope(appId: string, scopeId: string, patch: ScopeUpdate): AppScope | undefined;
  removeScope(appId: string, scopeId: string): boolean;

  addRole(appId: string, input: NewRole): AppRole;
  listRoles(appId: string): AppRole[];
  updateRole(appId: string, roleId: string, patch: RoleUpdate): AppRole | undefined;
  removeRole(appId: string, roleId: string): boolean;
}

export function createAppsRepository(db: Database, clock: Clock): AppsRepository {
  const selectById = db.prepare('SELECT * FROM app_registrations WHERE app_id = ?');
  const selectByUri = db.prepare('SELECT * FROM app_registrations WHERE app_id_uri = ?');
  const selectList = db.prepare(
    'SELECT * FROM app_registrations ORDER BY created_at, app_id LIMIT ? OFFSET ?',
  );
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM app_registrations');
  const insertApp = db.prepare(
    `INSERT INTO app_registrations
       (app_id, tenant_id, display_name, is_confidential, app_id_uri,
        optional_claims, group_membership_claims, group_overage_limit, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const deleteApp = db.prepare('DELETE FROM app_registrations WHERE app_id = ?');

  const insertRedirect = db.prepare(
    'INSERT INTO app_redirect_uris (app_id, uri, type) VALUES (?, ?, ?)',
  );
  const selectRedirectByAppUri = db.prepare(
    'SELECT * FROM app_redirect_uris WHERE app_id = ? AND uri = ?',
  );
  const listRedirects = db.prepare('SELECT * FROM app_redirect_uris WHERE app_id = ? ORDER BY id');
  const deleteRedirect = db.prepare('DELETE FROM app_redirect_uris WHERE app_id = ? AND uri = ?');

  const insertSecret = db.prepare(
    `INSERT INTO app_secrets (id, app_id, display_name, secret_hash, hint, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectSecretById = db.prepare('SELECT * FROM app_secrets WHERE id = ? AND app_id = ?');
  const listSecretsStmt = db.prepare(
    'SELECT * FROM app_secrets WHERE app_id = ? ORDER BY created_at, id',
  );
  const listSecretHashes = db.prepare(
    'SELECT secret_hash, expires_at FROM app_secrets WHERE app_id = ?',
  );
  const deleteSecret = db.prepare('DELETE FROM app_secrets WHERE id = ? AND app_id = ?');

  const insertScope = db.prepare(
    `INSERT INTO app_scopes (id, app_id, value, admin_consent_display_name, is_enabled)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const selectScopeById = db.prepare('SELECT * FROM app_scopes WHERE id = ? AND app_id = ?');
  const listScopesStmt = db.prepare('SELECT * FROM app_scopes WHERE app_id = ? ORDER BY value');
  const deleteScope = db.prepare('DELETE FROM app_scopes WHERE id = ? AND app_id = ?');

  const insertRole = db.prepare(
    `INSERT INTO app_roles (id, app_id, value, display_name, allowed_member_types, is_enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const selectRoleById = db.prepare('SELECT * FROM app_roles WHERE id = ? AND app_id = ?');
  const listRolesStmt = db.prepare('SELECT * FROM app_roles WHERE app_id = ? ORDER BY value');
  const deleteRole = db.prepare('DELETE FROM app_roles WHERE id = ? AND app_id = ?');

  const repo: AppsRepository = {
    getByAppId(appId) {
      const row = selectById.get(appId) as Row | undefined;
      return row ? mapApp(row) : undefined;
    },
    getByAppIdUri(appIdUri) {
      const row = selectByUri.get(appIdUri) as Row | undefined;
      return row ? mapApp(row) : undefined;
    },
    list(options) {
      const top = options?.top ?? 100;
      const skip = options?.skip ?? 0;
      const search = options?.search?.trim();
      if (search) {
        const like = `%${escapeLike(search)}%`;
        return (
          db
            .prepare(
              `SELECT * FROM app_registrations
                WHERE display_name LIKE ? ESCAPE '\\' OR app_id_uri LIKE ? ESCAPE '\\'
                ORDER BY created_at, app_id LIMIT ? OFFSET ?`,
            )
            .all(like, like, top, skip) as Row[]
        ).map(mapApp);
      }
      return (selectList.all(top, skip) as Row[]).map(mapApp);
    },
    count(options) {
      const search = options?.search?.trim();
      if (search) {
        const like = `%${escapeLike(search)}%`;
        const row = db
          .prepare(
            `SELECT COUNT(*) AS n FROM app_registrations
              WHERE display_name LIKE ? ESCAPE '\\' OR app_id_uri LIKE ? ESCAPE '\\'`,
          )
          .get(like, like) as Row;
        return reqNum(row, 'n');
      }
      return reqNum(countStmt.get() as Row, 'n');
    },
    create(input) {
      const appId = input.appId ?? randomUUID();
      insertApp.run(
        appId,
        input.tenantId,
        input.displayName,
        fromBool(input.isConfidential ?? false),
        input.appIdUri ?? null,
        serializeOptionalClaims(input.optionalClaims),
        input.groupMembershipClaims ?? 'None',
        input.groupOverageLimit ?? null,
        clock(),
      );
      return repo.getByAppId(appId) as AppRegistration;
    },
    update(appId, patch) {
      const existing = repo.getByAppId(appId);
      if (!existing) return undefined;
      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      if (patch.displayName !== undefined) {
        sets.push('display_name = ?');
        values.push(patch.displayName);
      }
      if (patch.isConfidential !== undefined) {
        sets.push('is_confidential = ?');
        values.push(fromBool(patch.isConfidential));
      }
      if (patch.appIdUri !== undefined) {
        sets.push('app_id_uri = ?');
        values.push(patch.appIdUri);
      }
      if (patch.optionalClaims !== undefined) {
        sets.push('optional_claims = ?');
        values.push(serializeOptionalClaims(patch.optionalClaims));
      }
      if (patch.groupMembershipClaims !== undefined) {
        sets.push('group_membership_claims = ?');
        values.push(patch.groupMembershipClaims);
      }
      if (patch.groupOverageLimit !== undefined) {
        sets.push('group_overage_limit = ?');
        values.push(patch.groupOverageLimit);
      }
      if (sets.length > 0) {
        db.prepare(`UPDATE app_registrations SET ${sets.join(', ')} WHERE app_id = ?`).run(
          ...values,
          appId,
        );
      }
      return repo.getByAppId(appId);
    },
    delete(appId) {
      return Number(deleteApp.run(appId).changes) > 0;
    },

    addRedirectUri(appId, uri, type = 'web') {
      insertRedirect.run(appId, uri, type);
      return mapRedirectUri(selectRedirectByAppUri.get(appId, uri) as Row);
    },
    listRedirectUris(appId) {
      return (listRedirects.all(appId) as Row[]).map(mapRedirectUri);
    },
    removeRedirectUri(appId, uri) {
      return Number(deleteRedirect.run(appId, uri).changes) > 0;
    },
    removeRedirectUriById(appId, id) {
      return (
        Number(
          db.prepare('DELETE FROM app_redirect_uris WHERE id = ? AND app_id = ?').run(id, appId)
            .changes,
        ) > 0
      );
    },

    addSecret(appId, input) {
      const id = input.id ?? randomUUID();
      const hint = secretHint(input.plaintext);
      const createdAt = clock();
      insertSecret.run(
        id,
        appId,
        input.displayName ?? null,
        hashSecret(input.plaintext),
        hint,
        input.expiresAt ?? null,
        createdAt,
      );
      const stored = mapSecret(selectSecretById.get(id, appId) as Row);
      return { ...stored, plaintext: input.plaintext };
    },
    listSecrets(appId) {
      return (listSecretsStmt.all(appId) as Row[]).map(mapSecret);
    },
    removeSecret(appId, secretId) {
      return Number(deleteSecret.run(secretId, appId).changes) > 0;
    },
    verifySecret(appId, plaintext) {
      const now = clock();
      const rows = listSecretHashes.all(appId) as Row[];
      for (const row of rows) {
        const expiresAt = optNum(row, 'expires_at');
        if (expiresAt != null && expiresAt <= now) continue;
        if (verifySecret(plaintext, reqStr(row, 'secret_hash'))) return true;
      }
      return false;
    },

    addScope(appId, input) {
      const id = input.id ?? randomUUID();
      insertScope.run(
        id,
        appId,
        input.value,
        input.adminConsentDisplayName ?? null,
        fromBool(input.isEnabled ?? true),
      );
      return mapScope(db.prepare('SELECT * FROM app_scopes WHERE id = ?').get(id) as Row);
    },
    listScopes(appId) {
      return (listScopesStmt.all(appId) as Row[]).map(mapScope);
    },
    updateScope(appId, scopeId, patch) {
      const existing = selectScopeById.get(scopeId, appId) as Row | undefined;
      if (!existing) return undefined;
      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      if (patch.adminConsentDisplayName !== undefined) {
        sets.push('admin_consent_display_name = ?');
        values.push(patch.adminConsentDisplayName);
      }
      if (patch.isEnabled !== undefined) {
        sets.push('is_enabled = ?');
        values.push(fromBool(patch.isEnabled));
      }
      if (sets.length > 0) {
        db.prepare(`UPDATE app_scopes SET ${sets.join(', ')} WHERE id = ? AND app_id = ?`).run(
          ...values,
          scopeId,
          appId,
        );
      }
      return mapScope(selectScopeById.get(scopeId, appId) as Row);
    },
    removeScope(appId, scopeId) {
      return Number(deleteScope.run(scopeId, appId).changes) > 0;
    },

    addRole(appId, input) {
      const id = input.id ?? randomUUID();
      insertRole.run(
        id,
        appId,
        input.value,
        input.displayName ?? null,
        input.allowedMemberTypes ?? 'Application',
        fromBool(input.isEnabled ?? true),
      );
      return mapRole(db.prepare('SELECT * FROM app_roles WHERE id = ?').get(id) as Row);
    },
    listRoles(appId) {
      return (listRolesStmt.all(appId) as Row[]).map(mapRole);
    },
    updateRole(appId, roleId, patch) {
      const existing = selectRoleById.get(roleId, appId) as Row | undefined;
      if (!existing) return undefined;
      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      if (patch.displayName !== undefined) {
        sets.push('display_name = ?');
        values.push(patch.displayName);
      }
      if (patch.allowedMemberTypes !== undefined) {
        sets.push('allowed_member_types = ?');
        values.push(patch.allowedMemberTypes);
      }
      if (patch.isEnabled !== undefined) {
        sets.push('is_enabled = ?');
        values.push(fromBool(patch.isEnabled));
      }
      if (sets.length > 0) {
        db.prepare(`UPDATE app_roles SET ${sets.join(', ')} WHERE id = ? AND app_id = ?`).run(
          ...values,
          roleId,
          appId,
        );
      }
      return mapRole(selectRoleById.get(roleId, appId) as Row);
    },
    removeRole(appId, roleId) {
      return Number(deleteRole.run(roleId, appId).changes) > 0;
    },
  };

  return repo;
}
