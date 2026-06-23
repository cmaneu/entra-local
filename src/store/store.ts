import type { Database } from './db.js';
import type { Repositories } from './repositories/index.js';
import { createRepositories } from './repositories/index.js';
import { reset, type ResetOptions } from './reset.js';
import { seed, type SeedResult } from './seed.js';
import type { Clock } from './util.js';
import { systemClock } from './util.js';

/** The repository bundle plus lifecycle/seed/reset operations decorated onto `app.store`. */
export interface Store extends Repositories {
  readonly db: Database;
  /** Idempotently seed the fixed-GUID demo directory. */
  seed(): SeedResult;
  /** Empty runtime data and (by default) re-seed; preserves the active signing key. */
  reset(options?: Pick<ResetOptions, 'reseed' | 'resetKeys'>): void;
  /** Close the underlying connection. */
  close(): void;
}

export interface CreateStoreOptions {
  tenantId: string;
  issuer: string;
  /** Injectable clock for deterministic timestamps in tests. Defaults to wall-clock. */
  clock?: Clock;
}

/**
 * Assemble the store bundle over an already-opened, migrated connection. `seed`/`reset` close over
 * the tenant identity from config so callers need not re-supply it.
 */
export function createStore(db: Database, options: CreateStoreOptions): Store {
  const clock = options.clock ?? systemClock;
  const repositories = createRepositories(db, clock);
  const seedOptions = { tenantId: options.tenantId, issuer: options.issuer };

  return {
    ...repositories,
    db,
    seed: () => seed(db, clock, seedOptions),
    reset: (opts) => reset(db, clock, { ...opts, ...seedOptions }),
    close: () => db.close(),
  };
}
