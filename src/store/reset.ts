import type { Database } from './db.js';
import { transaction } from './db.js';
import { seed, type SeedOptions } from './seed.js';
import type { Clock } from './util.js';

export interface ResetOptions extends SeedOptions {
  /** Re-run the deterministic seed after clearing. Default true. */
  reseed?: boolean;
  /** Also delete signing keys (forces #3 to regenerate). Default false (preserve active `kid`). */
  resetKeys?: boolean;
}

/**
 * Runtime-data tables in FK-safe deletion order (children before parents). The `tenants` row and,
 * unless `resetKeys`, `signing_keys` are intentionally preserved: the `signing_keys.tenant_id →
 * tenants.id` FK requires the tenant, and preserving the active key keeps a stable `kid`/JWKS
 * across resets (acceptance criterion 8). `schema_migrations` is never touched.
 */
const DATA_TABLES_IN_ORDER = [
  'group_members',
  'sessions',
  'authorization_codes',
  'refresh_tokens',
  'device_codes',
  'app_redirect_uris',
  'app_secrets',
  'app_scopes',
  'app_roles',
  'app_registrations',
  'groups',
  'users',
] as const;

/**
 * Empty the runtime data tables and optionally re-seed, inside one transaction. Preserves the
 * tenant row and (unless `resetKeys`) the active signing key.
 */
export function reset(db: Database, clock: Clock, options: ResetOptions): void {
  const reseed = options.reseed ?? true;
  const resetKeys = options.resetKeys ?? false;

  transaction(db, () => {
    for (const table of DATA_TABLES_IN_ORDER) {
      db.exec(`DELETE FROM ${table};`);
    }
    if (resetKeys) {
      db.exec('DELETE FROM signing_keys;');
    }
  });

  if (reseed) {
    seed(db, clock, { tenantId: options.tenantId, issuer: options.issuer });
  }
}
