import type { Database } from '../db.js';
import { transaction } from '../db.js';
import { sha256 } from '../hashing.js';
import type { NewRefreshToken, RefreshToken } from '../types.js';
import type { Row } from '../util.js';
import { asBool, optStr, reqNum, reqStr } from '../util.js';

function mapRefreshToken(row: Row): RefreshToken {
  return {
    tokenHash: reqStr(row, 'token'),
    appId: reqStr(row, 'app_id'),
    userId: reqStr(row, 'user_id'),
    scopes: reqStr(row, 'scopes'),
    resource: optStr(row, 'resource'),
    expiresAt: reqNum(row, 'expires_at'),
    rotatedFrom: optStr(row, 'rotated_from'),
    revoked: asBool(row, 'revoked'),
    createdAt: reqNum(row, 'created_at'),
  };
}

export interface RefreshTokensRepository {
  /** Store a refresh token hashed (SHA-256). Returns the stored row (hash, never plaintext). */
  insert(input: NewRefreshToken): RefreshToken;
  /** Look up by SHA-256 hash. Returns revoked/expired rows too (reuse detection is #7's job). */
  getByHash(tokenHash: string): RefreshToken | undefined;
  /**
   * Atomically rotate: revoke `oldHash` (compare-and-set on `revoked`) and, on success, insert the
   * new token chained via `rotated_from`. Returns the new row, or undefined if the old token was
   * already revoked/missing (caller treats this as reuse).
   */
  rotate(oldHash: string, replacement: NewRefreshToken): RefreshToken | undefined;
  /** Mark a token revoked. Returns true if a row transitioned to revoked. */
  revoke(tokenHash: string): boolean;
  /**
   * Revoke the entire rotation family reachable from `tokenHash`: the token plus every ancestor
   * (followed via `rotated_from`) and every descendant (rows whose `rotated_from` points back into
   * the chain). Used by #7's reuse/replay detection so a leaked-then-rotated token can no longer
   * mint anything. Keyed strictly to this one rotation chain — independent sign-ins for the same
   * `(app_id, user_id)` are separate chains (separate roots) and are NOT affected. Runs in one
   * transaction. Returns the number of rows that transitioned to revoked.
   */
  revokeFamily(tokenHash: string): number;
  deleteExpired(now: number): number;
}

export function createRefreshTokensRepository(
  db: Database,
  clock: () => number,
): RefreshTokensRepository {
  const insertStmt = db.prepare(
    `INSERT INTO refresh_tokens
       (token, app_id, user_id, scopes, resource, expires_at, rotated_from, revoked, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  );
  const selectByHash = db.prepare('SELECT * FROM refresh_tokens WHERE token = ?');
  const selectChildren = db.prepare('SELECT token FROM refresh_tokens WHERE rotated_from = ?');
  const revokeStmt = db.prepare(
    'UPDATE refresh_tokens SET revoked = 1 WHERE token = ? AND revoked = 0',
  );
  const deleteExpiredStmt = db.prepare('DELETE FROM refresh_tokens WHERE expires_at <= ?');

  function insertRow(input: NewRefreshToken): RefreshToken {
    const tokenHash = sha256(input.token);
    insertStmt.run(
      tokenHash,
      input.appId,
      input.userId,
      input.scopes,
      input.resource ?? null,
      input.expiresAt,
      input.rotatedFrom ?? null,
      clock(),
    );
    return mapRefreshToken(selectByHash.get(tokenHash) as Row);
  }

  const repo: RefreshTokensRepository = {
    insert(input) {
      return insertRow(input);
    },
    getByHash(tokenHash) {
      const row = selectByHash.get(tokenHash) as Row | undefined;
      return row ? mapRefreshToken(row) : undefined;
    },
    rotate(oldHash, replacement) {
      return transaction(db, () => {
        const revoked = Number(revokeStmt.run(oldHash).changes) > 0;
        if (!revoked) return undefined;
        return insertRow({ ...replacement, rotatedFrom: oldHash });
      });
    },
    revoke(tokenHash) {
      return Number(revokeStmt.run(tokenHash).changes) > 0;
    },
    revokeFamily(tokenHash) {
      return transaction(db, () => {
        // Collect the whole rotation chain reachable from the presented token by walking both
        // directions: backward via `rotated_from` (ancestors) and forward to children whose
        // `rotated_from` points at a chain member (descendants). The chain is linear in practice,
        // but BFS over a `seen` set is robust and terminates even on (impossible) cycles.
        const seen = new Set<string>();
        const queue: string[] = [tokenHash];
        while (queue.length > 0) {
          const hash = queue.pop() as string;
          if (seen.has(hash)) continue;
          seen.add(hash);
          const row = selectByHash.get(hash) as Row | undefined;
          if (row) {
            const parent = optStr(row, 'rotated_from');
            if (parent && !seen.has(parent)) queue.push(parent);
          }
          for (const child of selectChildren.all(hash) as Row[]) {
            const childHash = reqStr(child, 'token');
            if (!seen.has(childHash)) queue.push(childHash);
          }
        }
        let revoked = 0;
        for (const hash of seen) {
          revoked += Number(revokeStmt.run(hash).changes);
        }
        return revoked;
      });
    },
    deleteExpired(now) {
      return Number(deleteExpiredStmt.run(now).changes);
    },
  };

  return repo;
}
