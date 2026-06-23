import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, type Database } from '../../src/store/db.js';
import { runMigrations } from '../../src/store/migrations/index.js';
import { createStore, type Store } from '../../src/store/store.js';
import { TEST_TENANT_ID, TMP_DIR } from './constants.js';

/** Fixed epoch (seconds) injected as the store clock so seed/CRUD timestamps are byte-stable. */
export const FIXED_NOW = 1_700_000_000;

export interface TestStore {
  store: Store;
  db: Database;
  dbPath: string;
  /** The fixed clock value used for all writes. */
  now: number;
  close(): void;
}

/**
 * Open a migrated, ephemeral store with a fixed clock for unit-level repository tests. The DB file
 * (and its WAL sidecars) live under data/.tmp and are removed by `close()` (repo policy: never the
 * OS temp dir). Not seeded by default — call `store.seed()` where needed.
 */
export function buildTestStore(): TestStore {
  mkdirSync(TMP_DIR, { recursive: true });
  const dbPath = join(TMP_DIR, `${randomUUID()}.db`);
  const clock = () => FIXED_NOW;
  const db = openDatabase(dbPath);
  runMigrations(db, clock);
  const store = createStore(db, {
    tenantId: TEST_TENANT_ID,
    issuer: `http://localhost/${TEST_TENANT_ID}/v2.0`,
    clock,
  });

  return {
    store,
    db,
    dbPath,
    now: FIXED_NOW,
    close: () => {
      store.close();
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
    },
  };
}
