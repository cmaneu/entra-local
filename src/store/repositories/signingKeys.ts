import type { Database } from '../db.js';
import { transaction } from '../db.js';
import type { NewSigningKey, PublicSigningKey, SigningKey } from '../types.js';
import type { Clock, Row } from '../util.js';
import { asBool, fromBool, optNum, reqNum, reqStr } from '../util.js';

function mapKey(row: Row): SigningKey {
  return {
    kid: reqStr(row, 'kid'),
    tenantId: reqStr(row, 'tenant_id'),
    alg: reqStr(row, 'alg'),
    publicJwk: reqStr(row, 'public_jwk'),
    privatePkcs8: reqStr(row, 'private_pkcs8'),
    isActive: asBool(row, 'is_active'),
    createdAt: reqNum(row, 'created_at'),
    notAfter: optNum(row, 'not_after'),
  };
}

function mapPublicKey(row: Row): PublicSigningKey {
  return {
    kid: reqStr(row, 'kid'),
    tenantId: reqStr(row, 'tenant_id'),
    alg: reqStr(row, 'alg'),
    publicJwk: reqStr(row, 'public_jwk'),
    isActive: asBool(row, 'is_active'),
    createdAt: reqNum(row, 'created_at'),
    notAfter: optNum(row, 'not_after'),
  };
}

export interface SigningKeysRepository {
  getActive(tenantId: string): SigningKey | undefined;
  getByKid(kid: string): SigningKey | undefined;
  /** All keys for a tenant as public projections (for JWKS), active first. */
  listPublic(tenantId: string): PublicSigningKey[];
  insert(input: NewSigningKey): SigningKey;
  /** Make `kid` the sole active signer for its tenant (atomic). */
  setActive(kid: string, tenantId: string): boolean;
}

export function createSigningKeysRepository(db: Database, clock: Clock): SigningKeysRepository {
  const selectActive = db.prepare(
    'SELECT * FROM signing_keys WHERE tenant_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1',
  );
  const selectByKid = db.prepare('SELECT * FROM signing_keys WHERE kid = ?');
  const listPublicStmt = db.prepare(
    'SELECT * FROM signing_keys WHERE tenant_id = ? ORDER BY is_active DESC, created_at DESC',
  );
  const insertStmt = db.prepare(
    `INSERT INTO signing_keys
       (kid, tenant_id, alg, public_jwk, private_pkcs8, is_active, created_at, not_after)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const clearActive = db.prepare('UPDATE signing_keys SET is_active = 0 WHERE tenant_id = ?');
  const markActive = db.prepare(
    'UPDATE signing_keys SET is_active = 1 WHERE kid = ? AND tenant_id = ?',
  );

  const repo: SigningKeysRepository = {
    getActive(tenantId) {
      const row = selectActive.get(tenantId) as Row | undefined;
      return row ? mapKey(row) : undefined;
    },
    getByKid(kid) {
      const row = selectByKid.get(kid) as Row | undefined;
      return row ? mapKey(row) : undefined;
    },
    listPublic(tenantId) {
      return (listPublicStmt.all(tenantId) as Row[]).map(mapPublicKey);
    },
    insert(input) {
      const isActive = input.isActive ?? true;
      transaction(db, () => {
        if (isActive) clearActive.run(input.tenantId);
        insertStmt.run(
          input.kid,
          input.tenantId,
          input.alg ?? 'RS256',
          input.publicJwk,
          input.privatePkcs8,
          fromBool(isActive),
          clock(),
          input.notAfter ?? null,
        );
      });
      return repo.getByKid(input.kid) as SigningKey;
    },
    setActive(kid, tenantId) {
      return transaction(db, () => {
        clearActive.run(tenantId);
        return Number(markActive.run(kid, tenantId).changes) > 0;
      });
    },
  };

  return repo;
}
