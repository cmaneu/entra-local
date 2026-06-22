import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { Config } from '../../src/config/schema.js';
import { TMP_DIR, makeTestConfig } from './constants.js';

export interface TestApp {
  app: FastifyInstance;
  config: Config;
  inject: FastifyInstance['inject'];
  /** Ephemeral, unique per call (under data/.tmp; removed by close()). */
  dbPath: string;
  close(): Promise<void>;
}

/** Deep-merge test config overrides (handles the nested tls / tokenLifetimes objects). */
function mergeConfig(base: Config, overrides?: Partial<Config>): Config {
  if (!overrides) return base;
  return Object.freeze({
    ...base,
    ...overrides,
    tls: Object.freeze({ ...base.tls, ...overrides.tls }),
    tokenLifetimes: Object.freeze({ ...base.tokenLifetimes, ...overrides.tokenLifetimes }),
  }) satisfies Config;
}

/**
 * Boot helper for unit + integration tests. Builds an injectable app with a deterministic,
 * TLS-disabled config and a unique ephemeral `dbPath` (parallel-safe: each call gets its own
 * DB file). `close()` shuts the app down and removes the DB file.
 */
export async function buildTestApp(overrides?: Partial<Config>): Promise<TestApp> {
  mkdirSync(TMP_DIR, { recursive: true });
  const dbPath = join(TMP_DIR, `${randomUUID()}.db`);
  const config = mergeConfig(makeTestConfig(dbPath), overrides);
  const app = await buildApp(config);

  return {
    app,
    config,
    inject: app.inject.bind(app),
    dbPath,
    close: async () => {
      await app.close();
      rmSync(dbPath, { force: true });
    },
  };
}
