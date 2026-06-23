import type { Database } from '../db.js';
import type { Tenant } from '../types.js';
import type { Clock, Row } from '../util.js';
import { reqNum, reqStr } from '../util.js';

function mapTenant(row: Row): Tenant {
  return {
    id: reqStr(row, 'id'),
    displayName: reqStr(row, 'display_name'),
    issuer: reqStr(row, 'issuer'),
    createdAt: reqNum(row, 'created_at'),
  };
}

export interface NewTenant {
  id: string;
  displayName: string;
  issuer: string;
}

export interface TenantsRepository {
  get(id: string): Tenant | undefined;
  /** The single MVP tenant (first/lowest-id row), or undefined when the DB is unseeded. */
  getDefault(): Tenant | undefined;
  upsert(input: NewTenant): Tenant;
  count(): number;
}

export function createTenantsRepository(db: Database, clock: Clock): TenantsRepository {
  const selectById = db.prepare('SELECT * FROM tenants WHERE id = ?');
  const selectDefault = db.prepare('SELECT * FROM tenants ORDER BY created_at, id LIMIT 1');
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM tenants');
  const upsertStmt = db.prepare(
    `INSERT INTO tenants (id, display_name, issuer, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, issuer = excluded.issuer`,
  );

  return {
    get(id) {
      const row = selectById.get(id) as Row | undefined;
      return row ? mapTenant(row) : undefined;
    },
    getDefault() {
      const row = selectDefault.get() as Row | undefined;
      return row ? mapTenant(row) : undefined;
    },
    upsert(input) {
      upsertStmt.run(input.id, input.displayName, input.issuer, clock());
      return this.get(input.id) as Tenant;
    },
    count() {
      const row = countStmt.get() as Row;
      return reqNum(row, 'n');
    },
  };
}
