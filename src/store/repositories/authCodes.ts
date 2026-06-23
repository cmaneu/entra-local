import type { Database } from '../db.js';
import { transaction } from '../db.js';
import type { AuthCode, NewAuthCode } from '../types.js';
import type { Row } from '../util.js';
import { asBool, optStr, reqNum, reqStr } from '../util.js';

function mapAuthCode(row: Row): AuthCode {
  return {
    code: reqStr(row, 'code'),
    appId: reqStr(row, 'app_id'),
    userId: reqStr(row, 'user_id'),
    redirectUri: reqStr(row, 'redirect_uri'),
    scopes: reqStr(row, 'scopes'),
    resource: optStr(row, 'resource'),
    codeChallenge: optStr(row, 'code_challenge'),
    codeChallengeMethod: optStr(row, 'code_challenge_method'),
    nonce: optStr(row, 'nonce'),
    expiresAt: reqNum(row, 'expires_at'),
    consumed: asBool(row, 'consumed'),
    createdAt: reqNum(row, 'created_at'),
  };
}

export interface AuthCodesRepository {
  insert(input: NewAuthCode): AuthCode;
  getByCode(code: string): AuthCode | undefined;
  /**
   * Atomically mark a code consumed and return it. Single-use: succeeds exactly once; a second
   * call (or an unknown code) returns undefined. The returned row reflects the consumed state.
   */
  consume(code: string): AuthCode | undefined;
  deleteExpired(now: number): number;
}

export function createAuthCodesRepository(db: Database, clock: () => number): AuthCodesRepository {
  const insertStmt = db.prepare(
    `INSERT INTO authorization_codes
       (code, app_id, user_id, redirect_uri, scopes, resource, code_challenge,
        code_challenge_method, nonce, expires_at, consumed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  );
  const selectByCode = db.prepare('SELECT * FROM authorization_codes WHERE code = ?');
  const consumeStmt = db.prepare(
    'UPDATE authorization_codes SET consumed = 1 WHERE code = ? AND consumed = 0',
  );
  const deleteExpiredStmt = db.prepare('DELETE FROM authorization_codes WHERE expires_at <= ?');

  const repo: AuthCodesRepository = {
    insert(input) {
      insertStmt.run(
        input.code,
        input.appId,
        input.userId,
        input.redirectUri,
        input.scopes,
        input.resource ?? null,
        input.codeChallenge ?? null,
        input.codeChallengeMethod ?? null,
        input.nonce ?? null,
        input.expiresAt,
        clock(),
      );
      return repo.getByCode(input.code) as AuthCode;
    },
    getByCode(code) {
      const row = selectByCode.get(code) as Row | undefined;
      return row ? mapAuthCode(row) : undefined;
    },
    consume(code) {
      return transaction(db, () => {
        const changed = Number(consumeStmt.run(code).changes) > 0;
        if (!changed) return undefined;
        return repo.getByCode(code);
      });
    },
    deleteExpired(now) {
      return Number(deleteExpiredStmt.run(now).changes);
    },
  };

  return repo;
}
