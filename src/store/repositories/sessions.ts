import { randomUUID } from 'node:crypto';
import type { Database } from '../db.js';
import type { NewSession, Session } from '../types.js';
import type { Clock, Row } from '../util.js';
import { reqNum, reqStr } from '../util.js';

function mapSession(row: Row): Session {
  return {
    id: reqStr(row, 'id'),
    userId: reqStr(row, 'user_id'),
    createdAt: reqNum(row, 'created_at'),
    expiresAt: reqNum(row, 'expires_at'),
  };
}

export interface SessionsRepository {
  create(input: NewSession): Session;
  get(id: string): Session | undefined;
  delete(id: string): boolean;
  deleteExpired(now: number): number;
}

export function createSessionsRepository(db: Database, clock: Clock): SessionsRepository {
  const insertStmt = db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  );
  const selectById = db.prepare('SELECT * FROM sessions WHERE id = ?');
  const deleteStmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  const deleteExpiredStmt = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

  const repo: SessionsRepository = {
    create(input) {
      const id = input.id ?? randomUUID();
      insertStmt.run(id, input.userId, clock(), input.expiresAt);
      return repo.get(id) as Session;
    },
    get(id) {
      const row = selectById.get(id) as Row | undefined;
      return row ? mapSession(row) : undefined;
    },
    delete(id) {
      return Number(deleteStmt.run(id).changes) > 0;
    },
    deleteExpired(now) {
      return Number(deleteExpiredStmt.run(now).changes);
    },
  };

  return repo;
}
