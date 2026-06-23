import type { FastifyInstance } from 'fastify';
import { openDatabase } from './db.js';
import { runMigrations } from './migrations/index.js';
import { createStore, type Store } from './store.js';
import { systemClock } from './util.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The synchronous SQLite repository bundle (migrated, optionally seeded). */
    store: Store;
  }
}

/**
 * Open the configured DB, run migrations, decorate `app.store`, and register cleanup. Seeds when
 * `SEED_ON_START` (default: seed if empty) and the DB has no tenant row yet. Synchronous: every
 * step uses `node:sqlite`'s sync API, so the store is fully live by the time this returns.
 */
export function registerStore(app: FastifyInstance): void {
  const { config } = app;
  const db = openDatabase(config.dbPath);
  runMigrations(db, systemClock);

  const store = createStore(db, {
    tenantId: config.tenantId,
    issuer: config.issuer,
    clock: systemClock,
  });

  const seedEnabled = config.seedOnStart ?? true;
  if (seedEnabled && store.tenants.getDefault() === undefined) {
    store.seed();
  }

  app.decorate('store', store);
  app.addHook('onClose', () => {
    store.close();
  });
}
