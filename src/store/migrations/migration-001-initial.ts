/**
 * Migration 001 — initial schema. Creates every table, index, and foreign key for Iteration 1
 * (and the reserved `device_codes` table for #15). This is the canonical DDL contract referenced
 * by features #3, #5, #6, #7, #8, #9, #10, #11, #15; do not rename columns here without updating
 * the feature #2 spec.
 *
 * Notes:
 * - All `*_at` columns are integer Unix epoch seconds (UTC).
 * - GUID/text identifiers are stored as TEXT (lowercase canonical UUIDs).
 * - `group_members.user_id` and `sessions.user_id` cascade on user delete (acceptance criterion 2:
 *   deleting a user removes its memberships and sessions).
 */
export const MIGRATION_001_INITIAL = `
CREATE TABLE tenants (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  issuer       TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id),
  user_principal_name TEXT NOT NULL UNIQUE,
  display_name        TEXT NOT NULL,
  given_name          TEXT,
  surname             TEXT,
  mail                TEXT,
  password_hash       TEXT,
  account_enabled     INTEGER NOT NULL DEFAULT 1,
  created_at          INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_users_tenant_upn ON users(tenant_id, user_principal_name);
CREATE INDEX idx_users_mail ON users(mail);

CREATE TABLE groups (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  display_name TEXT NOT NULL,
  description  TEXT,
  created_at   INTEGER NOT NULL
);

CREATE TABLE group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_group_members_user ON group_members(user_id);

CREATE TABLE app_registrations (
  app_id          TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  display_name    TEXT NOT NULL,
  is_confidential INTEGER NOT NULL DEFAULT 0,
  app_id_uri      TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_app_registrations_tenant ON app_registrations(tenant_id);

CREATE TABLE app_redirect_uris (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL REFERENCES app_registrations(app_id) ON DELETE CASCADE,
  uri    TEXT NOT NULL,
  type   TEXT NOT NULL DEFAULT 'web',
  UNIQUE (app_id, uri)
);

CREATE TABLE app_secrets (
  id           TEXT PRIMARY KEY,
  app_id       TEXT NOT NULL REFERENCES app_registrations(app_id) ON DELETE CASCADE,
  display_name TEXT,
  secret_hash  TEXT NOT NULL,
  hint         TEXT,
  expires_at   INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE TABLE app_scopes (
  id                         TEXT PRIMARY KEY,
  app_id                     TEXT NOT NULL REFERENCES app_registrations(app_id) ON DELETE CASCADE,
  value                      TEXT NOT NULL,
  admin_consent_display_name TEXT,
  is_enabled                 INTEGER NOT NULL DEFAULT 1,
  UNIQUE (app_id, value)
);

CREATE TABLE app_roles (
  id                   TEXT PRIMARY KEY,
  app_id               TEXT NOT NULL REFERENCES app_registrations(app_id) ON DELETE CASCADE,
  value                TEXT NOT NULL,
  display_name         TEXT,
  allowed_member_types TEXT NOT NULL DEFAULT 'Application',
  is_enabled           INTEGER NOT NULL DEFAULT 1,
  UNIQUE (app_id, value)
);

CREATE TABLE signing_keys (
  kid           TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  alg           TEXT NOT NULL DEFAULT 'RS256',
  public_jwk    TEXT NOT NULL,
  private_pkcs8 TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  not_after     INTEGER
);
CREATE INDEX idx_signing_keys_active ON signing_keys(tenant_id, is_active);

CREATE TABLE authorization_codes (
  code                  TEXT PRIMARY KEY,
  app_id                TEXT NOT NULL REFERENCES app_registrations(app_id),
  user_id               TEXT NOT NULL REFERENCES users(id),
  redirect_uri          TEXT NOT NULL,
  scopes                TEXT NOT NULL,
  resource              TEXT,
  code_challenge        TEXT,
  code_challenge_method TEXT,
  nonce                 TEXT,
  expires_at            INTEGER NOT NULL,
  consumed              INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL
);
CREATE INDEX idx_authorization_codes_expires ON authorization_codes(expires_at);

CREATE TABLE refresh_tokens (
  token        TEXT PRIMARY KEY,
  app_id       TEXT NOT NULL REFERENCES app_registrations(app_id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  scopes       TEXT NOT NULL,
  resource     TEXT,
  expires_at   INTEGER NOT NULL,
  rotated_from TEXT,
  revoked      INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_refresh_tokens_app_user ON refresh_tokens(app_id, user_id);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE device_codes (
  device_code TEXT PRIMARY KEY,
  user_code   TEXT NOT NULL UNIQUE,
  app_id      TEXT NOT NULL REFERENCES app_registrations(app_id),
  user_id     TEXT,
  scopes      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  interval    INTEGER NOT NULL DEFAULT 5,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
`;
