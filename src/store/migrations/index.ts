import type { Database } from '../db.js';
import { transaction } from '../db.js';
import type { Clock } from '../util.js';
import { MIGRATION_001_INITIAL } from './migration-001-initial.js';

/** A forward-only migration: a version number and the SQL that brings the schema to it. */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Ordered list of forward-only migrations. Append new entries; never edit or reorder existing. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial', sql: MIGRATION_001_INITIAL },
];

/** Ensure the migration-tracking table exists. */
function ensureMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
}

/** Return the set of already-applied migration versions. */
function appliedVersions(db: Database): Set<number> {
  const rows = db.prepare('SELECT version FROM schema_migrations').all();
  return new Set(rows.map((r) => Number(r.version)));
}

/**
 * Apply all pending migrations in order, each inside its own transaction, recording the applied
 * version in `schema_migrations`. Idempotent: a re-boot against an up-to-date DB is a no-op.
 * Returns the list of versions applied during this call.
 */
export function runMigrations(db: Database, clock: Clock): number[] {
  ensureMigrationsTable(db);
  const applied = appliedVersions(db);
  const insert = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version)).sort(
    (a, b) => a.version - b.version,
  );

  const ranVersions: number[] = [];
  for (const migration of pending) {
    transaction(db, () => {
      db.exec(migration.sql);
      insert.run(migration.version, clock());
    });
    ranVersions.push(migration.version);
  }
  return ranVersions;
}
