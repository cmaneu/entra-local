import type { Database } from '../db.js';
import type { DeviceCode, NewDeviceCode } from '../types.js';
import type { Clock, Row } from '../util.js';
import { optStr, reqNum, reqStr } from '../util.js';

/**
 * Repository over the pre-existing `device_codes` table (RFC 8628, #15). The `device_code` PK holds
 * the SHA-256 hash of the opaque device code; `user_code` is the plaintext (canonical `XXXX-XXXX`)
 * human code with a UNIQUE index. Single-use redemption of an approved code is **atomic** via
 * `consumeApproved` (a guarded `DELETE ... RETURNING *`), closing the concurrent-poll double-mint
 * TOCTOU window.
 */

function mapDeviceCode(row: Row): DeviceCode {
  return {
    deviceCode: reqStr(row, 'device_code'),
    userCode: reqStr(row, 'user_code'),
    appId: reqStr(row, 'app_id'),
    userId: optStr(row, 'user_id'),
    scopes: reqStr(row, 'scopes'),
    status: reqStr(row, 'status') as DeviceCode['status'],
    interval: reqNum(row, 'interval'),
    expiresAt: reqNum(row, 'expires_at'),
    createdAt: reqNum(row, 'created_at'),
  };
}

export interface DeviceCodesRepository {
  /** Persist a new pending device-code row. Returns the stored row. */
  insert(input: NewDeviceCode): DeviceCode;
  /** Look up by the SHA-256 hash of the presented device code. */
  getByDeviceCodeHash(hash: string): DeviceCode | undefined;
  /** Look up by the (canonical) plaintext user code. */
  getByUserCode(userCode: string): DeviceCode | undefined;
  /** Whether a (canonical) user code is already in use (collision check on generation). */
  userCodeExists(userCode: string): boolean;
  /** Mark a pending row approved + bind the approving user. Returns the row, or undefined. */
  approve(userCode: string, userId: string): DeviceCode | undefined;
  /** Mark a pending row denied. Returns the row, or undefined. */
  deny(userCode: string): DeviceCode | undefined;
  /**
   * Atomic single-use redemption: a guarded `DELETE ... WHERE device_code=? AND app_id=? AND
   * status='approved' AND expires_at>? RETURNING *`. Returns the row iff it was still present,
   * approved, bound to this client and unexpired — else undefined (lost the race / already consumed
   * / expired / app_id mismatch). The only op the token grant's success path uses to read+remove an
   * approved code.
   */
  consumeApproved(hash: string, clientId: string, now: number): DeviceCode | undefined;
  /** Atomic delete-and-return by hash (lazy deletion of denied/expired rows). */
  consume(hash: string): DeviceCode | undefined;
  /** Delete all expired rows; returns the count. */
  deleteExpired(now: number): number;
}

export function createDeviceCodesRepository(db: Database, clock: Clock): DeviceCodesRepository {
  const insertStmt = db.prepare(
    `INSERT INTO device_codes
       (device_code, user_code, app_id, user_id, scopes, status, interval, expires_at, created_at)
     VALUES (?, ?, ?, NULL, ?, 'pending', ?, ?, ?)`,
  );
  const selectByHash = db.prepare('SELECT * FROM device_codes WHERE device_code = ?');
  const selectByUserCode = db.prepare('SELECT * FROM device_codes WHERE user_code = ?');
  const approveStmt = db.prepare(
    `UPDATE device_codes SET status = 'approved', user_id = ?
       WHERE user_code = ? AND status = 'pending'`,
  );
  const denyStmt = db.prepare(
    `UPDATE device_codes SET status = 'denied' WHERE user_code = ? AND status = 'pending'`,
  );
  const consumeApprovedStmt = db.prepare(
    `DELETE FROM device_codes
       WHERE device_code = ? AND app_id = ? AND status = 'approved' AND expires_at > ?
       RETURNING *`,
  );
  const consumeStmt = db.prepare('DELETE FROM device_codes WHERE device_code = ? RETURNING *');
  const deleteExpiredStmt = db.prepare('DELETE FROM device_codes WHERE expires_at <= ?');

  const repo: DeviceCodesRepository = {
    insert(input) {
      insertStmt.run(
        input.deviceCode,
        input.userCode,
        input.appId,
        input.scopes,
        input.interval,
        input.expiresAt,
        clock(),
      );
      return repo.getByDeviceCodeHash(input.deviceCode) as DeviceCode;
    },
    getByDeviceCodeHash(hash) {
      const row = selectByHash.get(hash) as Row | undefined;
      return row ? mapDeviceCode(row) : undefined;
    },
    getByUserCode(userCode) {
      const row = selectByUserCode.get(userCode) as Row | undefined;
      return row ? mapDeviceCode(row) : undefined;
    },
    userCodeExists(userCode) {
      return selectByUserCode.get(userCode) !== undefined;
    },
    approve(userCode, userId) {
      const changed = Number(approveStmt.run(userId, userCode).changes) > 0;
      return changed ? repo.getByUserCode(userCode) : undefined;
    },
    deny(userCode) {
      const changed = Number(denyStmt.run(userCode).changes) > 0;
      return changed ? repo.getByUserCode(userCode) : undefined;
    },
    consumeApproved(hash, clientId, now) {
      const row = consumeApprovedStmt.get(hash, clientId, now) as Row | undefined;
      return row ? mapDeviceCode(row) : undefined;
    },
    consume(hash) {
      const row = consumeStmt.get(hash) as Row | undefined;
      return row ? mapDeviceCode(row) : undefined;
    },
    deleteExpired(now) {
      return Number(deleteExpiredStmt.run(now).changes);
    },
  };

  return repo;
}
