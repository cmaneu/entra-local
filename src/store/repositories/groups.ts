import { randomUUID } from 'node:crypto';
import type { Database } from '../db.js';
import type { Group, GroupUpdate, NewGroup, User } from '../types.js';
import type { Clock, Row } from '../util.js';
import { asBool, escapeLike, optStr, reqNum, reqStr } from '../util.js';
import type { ListOptions } from './users.js';

function mapGroup(row: Row): Group {
  return {
    id: reqStr(row, 'id'),
    tenantId: reqStr(row, 'tenant_id'),
    displayName: reqStr(row, 'display_name'),
    description: optStr(row, 'description'),
    createdAt: reqNum(row, 'created_at'),
  };
}

function mapUser(row: Row): User {
  return {
    id: reqStr(row, 'id'),
    tenantId: reqStr(row, 'tenant_id'),
    userPrincipalName: reqStr(row, 'user_principal_name'),
    displayName: reqStr(row, 'display_name'),
    givenName: optStr(row, 'given_name'),
    surname: optStr(row, 'surname'),
    mail: optStr(row, 'mail'),
    accountEnabled: asBool(row, 'account_enabled'),
    hasPassword: row.password_hash != null,
    createdAt: reqNum(row, 'created_at'),
  };
}

export interface GroupsRepository {
  getById(id: string): Group | undefined;
  list(options?: ListOptions): Group[];
  count(options?: ListOptions): number;
  create(input: NewGroup): Group;
  update(id: string, patch: GroupUpdate): Group | undefined;
  delete(id: string): boolean;
  /** Number of users in the group. */
  memberCount(groupId: string): number;
  addMember(groupId: string, userId: string): void;
  removeMember(groupId: string, userId: string): boolean;
  listMembers(groupId: string): User[];
  listGroupsForUser(userId: string): Group[];
  isMember(groupId: string, userId: string): boolean;
}

export function createGroupsRepository(db: Database, clock: Clock): GroupsRepository {
  const selectById = db.prepare('SELECT * FROM groups WHERE id = ?');
  const selectList = db.prepare('SELECT * FROM groups ORDER BY created_at, id LIMIT ? OFFSET ?');
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM groups');
  const insertStmt = db.prepare(
    `INSERT INTO groups (id, tenant_id, display_name, description, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const deleteStmt = db.prepare('DELETE FROM groups WHERE id = ?');
  const addMemberStmt = db.prepare(
    'INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)',
  );
  const removeMemberStmt = db.prepare(
    'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
  );
  const isMemberStmt = db.prepare(
    'SELECT 1 AS hit FROM group_members WHERE group_id = ? AND user_id = ?',
  );
  const listMembersStmt = db.prepare(
    `SELECT u.* FROM users u
       JOIN group_members gm ON gm.user_id = u.id
      WHERE gm.group_id = ?
      ORDER BY u.created_at, u.id`,
  );
  const listGroupsForUserStmt = db.prepare(
    `SELECT g.* FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
      WHERE gm.user_id = ?
      ORDER BY g.created_at, g.id`,
  );
  const memberCountStmt = db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?');

  const repo: GroupsRepository = {
    getById(id) {
      const row = selectById.get(id) as Row | undefined;
      return row ? mapGroup(row) : undefined;
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
              `SELECT * FROM groups
                WHERE display_name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
                ORDER BY created_at, id LIMIT ? OFFSET ?`,
            )
            .all(like, like, top, skip) as Row[]
        ).map(mapGroup);
      }
      return (selectList.all(top, skip) as Row[]).map(mapGroup);
    },
    count(options) {
      const search = options?.search?.trim();
      if (search) {
        const like = `%${escapeLike(search)}%`;
        const row = db
          .prepare(
            `SELECT COUNT(*) AS n FROM groups
              WHERE display_name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'`,
          )
          .get(like, like) as Row;
        return reqNum(row, 'n');
      }
      return reqNum(countStmt.get() as Row, 'n');
    },
    create(input) {
      const id = input.id ?? randomUUID();
      insertStmt.run(id, input.tenantId, input.displayName, input.description ?? null, clock());
      return repo.getById(id) as Group;
    },
    update(id, patch) {
      const existing = repo.getById(id);
      if (!existing) return undefined;
      const sets: string[] = [];
      const values: (string | null)[] = [];
      if (patch.displayName !== undefined) {
        sets.push('display_name = ?');
        values.push(patch.displayName);
      }
      if (patch.description !== undefined) {
        sets.push('description = ?');
        values.push(patch.description);
      }
      if (sets.length > 0) {
        db.prepare(`UPDATE groups SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
      }
      return repo.getById(id);
    },
    delete(id) {
      return Number(deleteStmt.run(id).changes) > 0;
    },
    memberCount(groupId) {
      return reqNum(memberCountStmt.get(groupId) as Row, 'n');
    },
    addMember(groupId, userId) {
      addMemberStmt.run(groupId, userId);
    },
    removeMember(groupId, userId) {
      return Number(removeMemberStmt.run(groupId, userId).changes) > 0;
    },
    listMembers(groupId) {
      return (listMembersStmt.all(groupId) as Row[]).map(mapUser);
    },
    listGroupsForUser(userId) {
      return (listGroupsForUserStmt.all(userId) as Row[]).map(mapGroup);
    },
    isMember(groupId, userId) {
      return isMemberStmt.get(groupId, userId) !== undefined;
    },
  };

  return repo;
}
