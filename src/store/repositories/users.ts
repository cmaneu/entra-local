import { randomUUID } from 'node:crypto';
import type { Database } from '../db.js';
import { hashPassword, verifyPassword } from '../hashing.js';
import type { NewUser, User, UserUpdate } from '../types.js';
import type { Clock, Row } from '../util.js';
import { asBool, escapeLike, fromBool, optStr, reqNum, reqStr } from '../util.js';

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

export interface ListOptions {
  skip?: number;
  top?: number;
  /** Case-insensitive substring filter (resource-specific columns). */
  search?: string;
}

export interface UsersRepository {
  getById(id: string): User | undefined;
  getByUpn(upn: string): User | undefined;
  list(options?: ListOptions): User[];
  count(options?: ListOptions): number;
  create(input: NewUser): User;
  update(id: string, patch: UserUpdate): User | undefined;
  delete(id: string): boolean;
  verifyPassword(id: string, plaintext: string): boolean;
}

export function createUsersRepository(db: Database, clock: Clock): UsersRepository {
  const selectById = db.prepare('SELECT * FROM users WHERE id = ?');
  const selectByUpn = db.prepare('SELECT * FROM users WHERE user_principal_name = ?');
  const selectList = db.prepare('SELECT * FROM users ORDER BY created_at, id LIMIT ? OFFSET ?');
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM users');
  const insertStmt = db.prepare(
    `INSERT INTO users
       (id, tenant_id, user_principal_name, display_name, given_name, surname, mail,
        password_hash, account_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectHash = db.prepare('SELECT password_hash FROM users WHERE id = ?');
  const deleteStmt = db.prepare('DELETE FROM users WHERE id = ?');

  const repo: UsersRepository = {
    getById(id) {
      const row = selectById.get(id) as Row | undefined;
      return row ? mapUser(row) : undefined;
    },
    getByUpn(upn) {
      const row = selectByUpn.get(upn) as Row | undefined;
      return row ? mapUser(row) : undefined;
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
              `SELECT * FROM users
                WHERE user_principal_name LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\'
                ORDER BY created_at, id LIMIT ? OFFSET ?`,
            )
            .all(like, like, top, skip) as Row[]
        ).map(mapUser);
      }
      return (selectList.all(top, skip) as Row[]).map(mapUser);
    },
    count(options) {
      const search = options?.search?.trim();
      if (search) {
        const like = `%${escapeLike(search)}%`;
        const row = db
          .prepare(
            `SELECT COUNT(*) AS n FROM users
              WHERE user_principal_name LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\'`,
          )
          .get(like, like) as Row;
        return reqNum(row, 'n');
      }
      return reqNum(countStmt.get() as Row, 'n');
    },
    create(input) {
      const id = input.id ?? randomUUID();
      const passwordHash =
        input.password != null && input.password !== '' ? hashPassword(input.password) : null;
      insertStmt.run(
        id,
        input.tenantId,
        input.userPrincipalName,
        input.displayName,
        input.givenName ?? null,
        input.surname ?? null,
        input.mail ?? null,
        passwordHash,
        fromBool(input.accountEnabled ?? true),
        clock(),
      );
      return repo.getById(id) as User;
    },
    update(id, patch) {
      const existing = repo.getById(id);
      if (!existing) return undefined;

      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      const set = (column: string, value: string | number | null): void => {
        sets.push(`${column} = ?`);
        values.push(value);
      };

      if (patch.userPrincipalName !== undefined)
        set('user_principal_name', patch.userPrincipalName);
      if (patch.displayName !== undefined) set('display_name', patch.displayName);
      if (patch.givenName !== undefined) set('given_name', patch.givenName);
      if (patch.surname !== undefined) set('surname', patch.surname);
      if (patch.mail !== undefined) set('mail', patch.mail);
      if (patch.accountEnabled !== undefined)
        set('account_enabled', fromBool(patch.accountEnabled));
      if (patch.password !== undefined) {
        set('password_hash', patch.password ? hashPassword(patch.password) : null);
      }

      if (sets.length > 0) {
        db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
      }
      return repo.getById(id);
    },
    delete(id) {
      return Number(deleteStmt.run(id).changes) > 0;
    },
    verifyPassword(id, plaintext) {
      const row = selectHash.get(id) as Row | undefined;
      const hash = row ? optStr(row, 'password_hash') : null;
      if (hash == null) return false;
      return verifyPassword(plaintext, hash);
    },
  };

  return repo;
}
