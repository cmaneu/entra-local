import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** The concrete synchronous SQLite connection type used throughout the store layer. */
export type Database = DatabaseSync;

/**
 * Open the SQLite database at `dbPath` and apply the connection pragmas required by the store
 * contract: WAL journaling (concurrent reads), enforced foreign keys (cascade integrity), and a
 * 5s busy timeout. The parent directory is created if missing. Never opened at import time — the
 * caller (store plugin / test harness) supplies the config-driven path.
 */
export function openDatabase(dbPath: string): Database {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

/** Run `fn` inside an IMMEDIATE transaction, committing on success and rolling back on error. */
export function transaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
