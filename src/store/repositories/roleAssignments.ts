import type { Database } from '../db.js';
import { reqNum, reqStr, type Row } from '../util.js';

export interface RoleAssignment {
  roleId: string;
  userId: string;
}

export interface RoleAssignmentsRepository {
  list(appId: string, top: number, skip: number): RoleAssignment[];
  count(appId: string): number;
  has(roleId: string, userId: string): boolean;
  add(roleId: string, userId: string): void;
  remove(appId: string, roleId: string, userId: string): void;
  values(appId: string, userId: string): string[];
}

export function createRoleAssignmentsRepository(db: Database): RoleAssignmentsRepository {
  const list = db.prepare(`
    SELECT a.role_id, a.user_id FROM user_app_role_assignments a
    JOIN app_roles r ON r.id = a.role_id WHERE r.app_id = ?
    ORDER BY a.role_id, a.user_id LIMIT ? OFFSET ?
  `);
  const count = db.prepare(`
    SELECT COUNT(*) AS n FROM user_app_role_assignments a
    JOIN app_roles r ON r.id = a.role_id WHERE r.app_id = ?
  `);
  const has = db.prepare(
    'SELECT 1 FROM user_app_role_assignments WHERE role_id = ? AND user_id = ?',
  );
  const add = db.prepare(
    'INSERT OR IGNORE INTO user_app_role_assignments (role_id, user_id) VALUES (?, ?)',
  );
  const remove = db.prepare(`
    DELETE FROM user_app_role_assignments WHERE role_id = ? AND user_id = ?
    AND role_id IN (SELECT id FROM app_roles WHERE app_id = ?)
  `);
  // Disabling a role prevents new assignments; it does not revoke existing grants in Entra.
  const values = db.prepare(`
    SELECT r.value FROM user_app_role_assignments a
    JOIN app_roles r ON r.id = a.role_id
    JOIN app_registrations app ON app.app_id = r.app_id
    JOIN users u ON u.id = a.user_id AND u.tenant_id = app.tenant_id
    WHERE r.app_id = ? AND a.user_id = ? ORDER BY r.value
  `);
  return {
    list(appId, top, skip) {
      return (list.all(appId, top, skip) as Row[]).map((row) => ({
        roleId: reqStr(row, 'role_id'),
        userId: reqStr(row, 'user_id'),
      }));
    },
    count(appId) {
      return reqNum(count.get(appId) as Row, 'n');
    },
    has(roleId, userId) {
      return has.get(roleId, userId) !== undefined;
    },
    add(roleId, userId) {
      add.run(roleId, userId);
    },
    remove(appId, roleId, userId) {
      remove.run(roleId, userId, appId);
    },
    values(appId, userId) {
      return (values.all(appId, userId) as Row[]).map((row) => reqStr(row, 'value'));
    },
  };
}
