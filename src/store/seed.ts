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
  /**
   * Full-stack sample (#24): a dedicated front-end SPA app and a separate back-end API resource
   * app. The SPA requests `api://<appApiId>/access_as_user`, so the minted access token's `aud` is
   * the API app and the Express API validates it against the emulator JWKS. One registration per
   * tier — these are distinct from the generic `appSpaId`/`appDaemonId` above.
   */
  appSpaFrontId: 'cccccccc-0000-0000-0000-000000000004',
  appApiId: 'cccccccc-0000-0000-0000-000000000005',
  apiScopeId: 'dddddddd-0000-0000-0000-000000000002',
  apiScopeValue: 'access_as_user',
  /**
   * A second delegated scope on the API app. The Express API authorizes `/api/todos` on
   * `access_as_user` only, so a token carrying just `access_as_admin` has the right `aud` but the
   * wrong `scp` — the sample uses it to demonstrate (and CI-smoke) the `403 insufficient_scope` path.
   */
  apiAdminScopeId: 'dddddddd-0000-0000-0000-000000000003',
  apiAdminScopeValue: 'access_as_admin',
  spaFrontRedirectUri: 'http://localhost:5173',
  /**
   * Token-configuration sample (optional claims + group claims). A dedicated web client and API
   * resource app plus a richer set of users/groups so developers can exercise optional ID-token
   * claims, optional access-token claims, group claims, and group-overage behavior without touching
   * the other samples' registrations. Group IDs are fixed so the `groups` claim is stable.
   */
  appWebClientId: 'cccccccc-0000-0000-0000-000000000006',
  appTokenApiId: 'cccccccc-0000-0000-0000-000000000007',
  tokenApiScopeId: 'dddddddd-0000-0000-0000-000000000004',
  tokenApiScopeValue: 'access_as_user',
  webClientRedirectUri: 'http://localhost:3000',
  /** OBO SPA → confidential middle-tier API sample (#28). */
  appOboSpaId: 'cccccccc-0000-0000-0000-000000000008',
  appOboApiId: 'cccccccc-0000-0000-0000-000000000009',
  oboApiScopeId: 'dddddddd-0000-0000-0000-000000000005',
  oboApiScopeValue: 'access_as_user',
  oboApiSecretId: 'ffffffff-0000-0000-0000-000000000002',
  oboSpaRedirectUri: 'http://localhost:5174',
  oboApiSecret: 'obo-middle-tier-secret',
  /** Group overage limit on the sample apps — deliberately small so a 4-group user overflows. */
  sampleGroupOverageLimit: 3,
  groupDevelopersId: 'bbbbbbbb-0000-0000-0000-000000000002',
  groupDataTeamId: 'bbbbbbbb-0000-0000-0000-000000000003',
  groupLocalAdminsId: 'bbbbbbbb-0000-0000-0000-000000000004',
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

    // Full-stack sample (#24) — front SPA app: redirect on its own port, no exposed scope of its
    // own (it consumes the API app's scope).
    run(
      `INSERT OR IGNORE INTO app_registrations
         (app_id, tenant_id, display_name, is_confidential, app_id_uri, created_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
      SEED.appSpaFrontId,
      options.tenantId,
      'Sample Full-stack SPA',
      `api://${SEED.appSpaFrontId}`,
      now,
    );
    run(
      `INSERT OR IGNORE INTO app_redirect_uris (app_id, uri, type) VALUES (?, ?, ?)`,
      SEED.appSpaFrontId,
      SEED.spaFrontRedirectUri,
      'spa',
    );

    // Full-stack sample (#24) — back API resource app: public (no secret), exposes `access_as_user`.
    // The SPA requests `api://<appApiId>/access_as_user`, so the access token's `aud` = this app.
    run(
      `INSERT OR IGNORE INTO app_registrations
         (app_id, tenant_id, display_name, is_confidential, app_id_uri, created_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
      SEED.appApiId,
      options.tenantId,
      'Sample Full-stack API',
      `api://${SEED.appApiId}`,
      now,
    );
    run(
      `INSERT OR IGNORE INTO app_scopes
         (id, app_id, value, admin_consent_display_name, is_enabled)
       VALUES (?, ?, ?, ?, 1)`,
      SEED.apiScopeId,
      SEED.appApiId,
      SEED.apiScopeValue,
      'Access the Sample API as the signed-in user',
    );
    // Second exposed scope: the SPA can hold it, but `/api/todos` requires `access_as_user`, so a
    // token with only this scope yields `403 insufficient_scope` (right `aud`, wrong `scp`).
    run(
      `INSERT OR IGNORE INTO app_scopes
         (id, app_id, value, admin_consent_display_name, is_enabled)
       VALUES (?, ?, ?, ?, 1)`,
      SEED.apiAdminScopeId,
      SEED.appApiId,
      SEED.apiAdminScopeValue,
      'Access the Sample API with administrative scope',
    );

    // --- Token-configuration sample (optional claims + group claims) ------------------------------
    // Extra groups + memberships (on the existing Alice/Bob users) so optional/group claims and the
    // overage payload are demonstrable. Alice lands in 4 groups (> the sample overage limit of 3, so
    // her tokens carry an overage claim); Bob stays under the limit and receives a `groups` array.
    for (const g of [
      { id: SEED.groupDevelopersId, name: 'Developers', desc: 'Local developers group' },
      { id: SEED.groupDataTeamId, name: 'Data Team', desc: 'Data team' },
      { id: SEED.groupLocalAdminsId, name: 'Local Admins', desc: 'Local administrators' },
    ]) {
      run(
        `INSERT OR IGNORE INTO groups (id, tenant_id, display_name, description, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        g.id,
        options.tenantId,
        g.name,
        g.desc,
        now,
      );
    }
    const memberships: [string, string][] = [
      [SEED.groupDevelopersId, SEED.userAliceId],
      [SEED.groupDataTeamId, SEED.userAliceId],
      [SEED.groupLocalAdminsId, SEED.userAliceId],
      [SEED.groupDevelopersId, SEED.userBobId],
    ];
    for (const [groupId, userId] of memberships) {
      run(`INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)`, groupId, userId);
    }

    // local-web-client: public SPA whose *ID token* receives optional claims + security-group claims.
    run(
      `INSERT OR IGNORE INTO app_registrations
         (app_id, tenant_id, display_name, is_confidential, app_id_uri,
          optional_claims, group_membership_claims, group_overage_limit, created_at)
       VALUES (?, ?, ?, 0, ?, ?, 'SecurityGroup', ?, ?)`,
      SEED.appWebClientId,
      options.tenantId,
      'local-web-client',
      `api://${SEED.appWebClientId}`,
      JSON.stringify({
        idToken: [
          { name: 'email', essential: false },
          { name: 'upn', essential: false },
          { name: 'given_name', essential: false },
          { name: 'family_name', essential: false },
          { name: 'groups', essential: false },
        ],
        accessToken: [],
      }),
      SEED.sampleGroupOverageLimit,
      now,
    );
    run(
      `INSERT OR IGNORE INTO app_redirect_uris (app_id, uri, type) VALUES (?, ?, ?)`,
      SEED.appWebClientId,
      SEED.webClientRedirectUri,
      'spa',
    );

    // local-api: resource/API app whose *access token* receives optional claims + group claims. The
    // web client requests `api://<appTokenApiId>/access_as_user`, so the token's `aud` is this app
    // and its access-token token-configuration applies (not the client's).
    run(
      `INSERT OR IGNORE INTO app_registrations
         (app_id, tenant_id, display_name, is_confidential, app_id_uri,
          optional_claims, group_membership_claims, group_overage_limit, created_at)
       VALUES (?, ?, ?, 0, ?, ?, 'SecurityGroup', ?, ?)`,
      SEED.appTokenApiId,
      options.tenantId,
      'local-api',
      `api://${SEED.appTokenApiId}`,
      JSON.stringify({
        idToken: [],
        accessToken: [
          { name: 'email', essential: false },
          { name: 'upn', essential: false },
          { name: 'groups', essential: false },
        ],
      }),
      SEED.sampleGroupOverageLimit,
      now,
    );
    run(
      `INSERT OR IGNORE INTO app_scopes
         (id, app_id, value, admin_consent_display_name, is_enabled)
       VALUES (?, ?, ?, ?, 1)`,
      SEED.tokenApiScopeId,
      SEED.appTokenApiId,
      SEED.tokenApiScopeValue,
      'Access the local API as the signed-in user',
    );

    // OBO sample (#28): public browser client calls a confidential middle-tier API. The middle tier
    // authenticates with its known development-only secret when exchanging the incoming token.
    run(
      `INSERT OR IGNORE INTO app_registrations
         (app_id, tenant_id, display_name, is_confidential, app_id_uri, created_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
      SEED.appOboSpaId,
      options.tenantId,
      'Sample OBO SPA',
      `api://${SEED.appOboSpaId}`,
      now,
    );
    run(
      `INSERT OR IGNORE INTO app_redirect_uris (app_id, uri, type) VALUES (?, ?, ?)`,
      SEED.appOboSpaId,
      SEED.oboSpaRedirectUri,
      'spa',
    );
    run(
      `INSERT OR IGNORE INTO app_registrations
         (app_id, tenant_id, display_name, is_confidential, app_id_uri, created_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
      SEED.appOboApiId,
      options.tenantId,
      'Sample OBO Middle-tier API',
      `api://${SEED.appOboApiId}`,
      now,
    );
    run(
      `INSERT OR IGNORE INTO app_scopes
         (id, app_id, value, admin_consent_display_name, is_enabled)
       VALUES (?, ?, ?, ?, 1)`,
      SEED.oboApiScopeId,
      SEED.appOboApiId,
      SEED.oboApiScopeValue,
      'Access the OBO middle-tier API as the signed-in user',
    );
    run(
      `INSERT OR IGNORE INTO app_secrets
         (id, app_id, display_name, secret_hash, hint, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      SEED.oboApiSecretId,
      SEED.appOboApiId,
      'OBO sample secret',
      hashSecret(SEED.oboApiSecret),
      `${SEED.oboApiSecret.slice(0, 3)}…${SEED.oboApiSecret.slice(-2)}`,
      now,
    );

    return { inserted };
  });
}
