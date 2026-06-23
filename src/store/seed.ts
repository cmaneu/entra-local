import type { Database } from './db.js';
import { transaction } from './db.js';
import { hashPassword, hashSecret } from './hashing.js';
import type { Clock } from './util.js';

/**
 * Deterministic seed data with fixed GUIDs. These identifiers are part of the canonical contract:
 * tests and later features (and MSAL sample configs) reference them verbatim. The seeded password
 * and daemon secret are intentionally known dev-only values (documented in the README security
 * disclaimer) — never use this build with real credentials.
 */
export const SEED = {
  /** Tenant id falls back to the configured tenant so the issuer matches. */
  userAliceId: 'aaaaaaaa-0000-0000-0000-000000000001',
  userBobId: 'aaaaaaaa-0000-0000-0000-000000000002',
  groupEngineeringId: 'bbbbbbbb-0000-0000-0000-000000000001',
  appSpaId: 'cccccccc-0000-0000-0000-000000000001',
  appDaemonId: 'cccccccc-0000-0000-0000-000000000002',
  spaScopeId: 'dddddddd-0000-0000-0000-000000000001',
  daemonRoleId: 'eeeeeeee-0000-0000-0000-000000000001',
  daemonSecretId: 'ffffffff-0000-0000-0000-000000000001',
  spaRedirectUri: 'https://localhost:3000',
  spaScopeValue: 'access_as_user',
  daemonRoleValue: 'Tasks.Read.All',
  /** Known dev-only credentials. */
  userPassword: 'Password1!',
  daemonSecret: 'daemon-app-secret',
} as const;

export interface SeedOptions {
  /** Tenant GUID (from config); used as the tenants.id and FK parent. */
  tenantId: string;
  /** Tenant issuer (from config). */
  issuer: string;
}

export interface SeedResult {
  /** Number of rows inserted across all tables (0 when everything already existed). */
  inserted: number;
}

/**
 * Seed the database with the fixed-GUID demo directory. Idempotent: uses `INSERT OR IGNORE`, so a
 * re-seed (or `force` mode in #11) inserts only missing rows and leaves existing rows (and their
 * non-deterministic password/secret hashes) untouched. Runs inside a single transaction.
 */
export function seed(db: Database, clock: Clock, options: SeedOptions): SeedResult {
  const now = clock();

  return transaction(db, () => {
    let inserted = 0;
    const run = (sql: string, ...params: (string | number | null)[]): void => {
      inserted += Number(db.prepare(sql).run(...params).changes);
    };

    run(
      `INSERT OR IGNORE INTO tenants (id, display_name, issuer, created_at) VALUES (?, ?, ?, ?)`,
      options.tenantId,
      'Entra Local',
      options.issuer,
      now,
    );

    const passwordHash = hashPassword(SEED.userPassword);
    run(
      `INSERT OR IGNORE INTO users
         (id, tenant_id, user_principal_name, display_name, given_name, surname, mail,
          password_hash, account_enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      SEED.userAliceId,
      options.tenantId,
      'alice@entralocal.dev',
      'Alice Example',
      'Alice',
      'Example',
      'alice@entralocal.dev',
      passwordHash,
      now,
    );
    run(
      `INSERT OR IGNORE INTO users
         (id, tenant_id, user_principal_name, display_name, given_name, surname, mail,
          password_hash, account_enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      SEED.userBobId,
      options.tenantId,
      'bob@entralocal.dev',
      'Bob Example',
      'Bob',
      'Example',
      'bob@entralocal.dev',
      hashPassword(SEED.userPassword),
      now,
    );

    run(
      `INSERT OR IGNORE INTO groups (id, tenant_id, display_name, description, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      SEED.groupEngineeringId,
      options.tenantId,
      'Engineering',
      'Engineering team',
      now,
    );
    run(
      `INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)`,
      SEED.groupEngineeringId,
      SEED.userAliceId,
    );
    run(
      `INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)`,
      SEED.groupEngineeringId,
      SEED.userBobId,
    );

    // Public SPA app: redirect + exposed delegated scope.
    run(
      `INSERT OR IGNORE INTO app_registrations
         (app_id, tenant_id, display_name, is_confidential, app_id_uri, created_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
      SEED.appSpaId,
      options.tenantId,
      'Sample SPA',
      `api://${SEED.appSpaId}`,
      now,
    );
    run(
      `INSERT OR IGNORE INTO app_redirect_uris (app_id, uri, type) VALUES (?, ?, ?)`,
      SEED.appSpaId,
      SEED.spaRedirectUri,
      'spa',
    );
    run(
      `INSERT OR IGNORE INTO app_scopes
         (id, app_id, value, admin_consent_display_name, is_enabled)
       VALUES (?, ?, ?, ?, 1)`,
      SEED.spaScopeId,
      SEED.appSpaId,
      SEED.spaScopeValue,
      'Access Sample SPA as the signed-in user',
    );

    // Confidential daemon app: known hashed secret + app role.
    run(
      `INSERT OR IGNORE INTO app_registrations
         (app_id, tenant_id, display_name, is_confidential, app_id_uri, created_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
      SEED.appDaemonId,
      options.tenantId,
      'Sample Daemon',
      `api://${SEED.appDaemonId}`,
      now,
    );
    run(
      `INSERT OR IGNORE INTO app_secrets
         (id, app_id, display_name, secret_hash, hint, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      SEED.daemonSecretId,
      SEED.appDaemonId,
      'Seed secret',
      hashSecret(SEED.daemonSecret),
      `${SEED.daemonSecret.slice(0, 3)}…${SEED.daemonSecret.slice(-2)}`,
      now,
    );
    run(
      `INSERT OR IGNORE INTO app_roles
         (id, app_id, value, display_name, allowed_member_types, is_enabled)
       VALUES (?, ?, ?, ?, 'Application', 1)`,
      SEED.daemonRoleId,
      SEED.appDaemonId,
      SEED.daemonRoleValue,
      'Read all tasks',
    );

    return { inserted };
  });
}
