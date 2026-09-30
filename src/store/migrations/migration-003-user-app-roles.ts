/** Direct user assignments; role ownership supplies the app ID. */
export const MIGRATION_003_USER_APP_ROLES = `
CREATE TABLE user_app_role_assignments (
  role_id TEXT NOT NULL REFERENCES app_roles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, user_id)
);
CREATE INDEX idx_user_app_roles_user ON user_app_role_assignments(user_id);
`;
