import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256 } from '../../src/store/hashing.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';
import { buildTestStore, FIXED_NOW, type TestStore } from '../helpers/buildTestStore.js';

let ctx: TestStore;

beforeEach(() => {
  ctx = buildTestStore();
  // Every test needs the tenant FK parent; seed the directory once.
  ctx.store.seed();
});

afterEach(() => {
  ctx.close();
});

describe('users repository CRUD (criterion 4 + 5)', () => {
  it('round-trips create/read/update/delete and never exposes the hash', () => {
    const { users } = ctx.store;
    const created = users.create({
      tenantId: TEST_TENANT_ID,
      userPrincipalName: 'carol@entralocal.dev',
      displayName: 'Carol',
      mail: 'carol@entralocal.dev',
      password: 'Hunter2!',
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.hasPassword).toBe(true);
    expect(created.createdAt).toBe(FIXED_NOW);
    expect(created as unknown as Record<string, unknown>).not.toHaveProperty('passwordHash');

    expect(users.getById(created.id)?.userPrincipalName).toBe('carol@entralocal.dev');
    expect(users.getByUpn('carol@entralocal.dev')?.id).toBe(created.id);

    const updated = users.update(created.id, {
      displayName: 'Carol Updated',
      accountEnabled: false,
    });
    expect(updated?.displayName).toBe('Carol Updated');
    expect(updated?.accountEnabled).toBe(false);

    // Verify password persists hashed (not equal to input) and round-trips.
    const row = ctx.db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(created.id) as Record<string, unknown>;
    expect(row.password_hash).not.toBe('Hunter2!');
    expect(users.verifyPassword(created.id, 'Hunter2!')).toBe(true);
    expect(users.verifyPassword(created.id, 'nope')).toBe(false);

    expect(users.delete(created.id)).toBe(true);
    expect(users.getById(created.id)).toBeUndefined();
    expect(users.delete(created.id)).toBe(false);
  });
});

describe('groups repository + membership (criterion 4)', () => {
  it('creates groups and manages membership both directions', () => {
    const { groups, users } = ctx.store;
    const alice = users.getByUpn('alice@entralocal.dev')!;
    const g = groups.create({ tenantId: TEST_TENANT_ID, displayName: 'Design' });

    groups.addMember(g.id, alice.id);
    groups.addMember(g.id, alice.id); // idempotent
    expect(groups.isMember(g.id, alice.id)).toBe(true);
    expect(groups.listMembers(g.id).map((u) => u.id)).toEqual([alice.id]);
    expect(groups.listGroupsForUser(alice.id).map((x) => x.displayName)).toContain('Design');

    expect(groups.removeMember(g.id, alice.id)).toBe(true);
    expect(groups.isMember(g.id, alice.id)).toBe(false);

    expect(groups.update(g.id, { description: 'Design team' })?.description).toBe('Design team');
    expect(groups.delete(g.id)).toBe(true);
    expect(groups.getById(g.id)).toBeUndefined();
  });
});

describe('apps repository + children (criterion 4 + 5)', () => {
  it('round-trips an app with redirect URIs, secrets, scopes, and roles', () => {
    const { apps } = ctx.store;
    const app = apps.create({
      tenantId: TEST_TENANT_ID,
      displayName: 'My App',
      isConfidential: true,
      appIdUri: 'api://my-app',
    });

    const redirect = apps.addRedirectUri(app.appId, 'https://localhost:4000', 'web');
    expect(redirect.id).toBeTypeOf('number');
    expect(apps.listRedirectUris(app.appId).map((r) => r.uri)).toEqual(['https://localhost:4000']);

    const secret = apps.addSecret(app.appId, { plaintext: 'top-secret-value', displayName: 'k1' });
    expect(secret.plaintext).toBe('top-secret-value');
    // The persisted list never includes plaintext; the hash is not the input.
    const persisted = apps.listSecrets(app.appId);
    expect(persisted[0]).not.toHaveProperty('plaintext');
    const hashRow = ctx.db
      .prepare('SELECT secret_hash FROM app_secrets WHERE id = ?')
      .get(secret.id) as Record<string, unknown>;
    expect(hashRow.secret_hash).not.toBe('top-secret-value');
    expect(apps.verifySecret(app.appId, 'top-secret-value')).toBe(true);
    expect(apps.verifySecret(app.appId, 'wrong')).toBe(false);

    const scope = apps.addScope(app.appId, { value: 'read' });
    expect(apps.listScopes(app.appId).map((s) => s.value)).toEqual(['read']);
    const role = apps.addRole(app.appId, { value: 'Admin.All' });
    expect(apps.listRoles(app.appId).map((r) => r.value)).toEqual(['Admin.All']);

    expect(apps.removeScope(app.appId, scope.id)).toBe(true);
    expect(apps.removeRole(app.appId, role.id)).toBe(true);
    expect(apps.getByAppIdUri('api://my-app')?.appId).toBe(app.appId);
  });

  it('expired secrets do not verify', () => {
    const { apps } = ctx.store;
    const app = apps.create({ tenantId: TEST_TENANT_ID, displayName: 'Exp' });
    apps.addSecret(app.appId, { plaintext: 'old', expiresAt: FIXED_NOW - 1 });
    expect(apps.verifySecret(app.appId, 'old')).toBe(false);
  });
});

describe('foreign-key cascades (criterion 2)', () => {
  it('deleting an app removes its redirect URIs/secrets/scopes/roles', () => {
    const { apps, db } = { apps: ctx.store.apps, db: ctx.db };
    const appId = 'cccccccc-0000-0000-0000-000000000002'; // seeded daemon: secret + role
    apps.addRedirectUri(appId, 'https://localhost:9', 'web');
    apps.addScope(appId, { value: 'x' });

    expect(apps.delete(appId)).toBe(true);
    for (const table of ['app_redirect_uris', 'app_secrets', 'app_scopes', 'app_roles']) {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE app_id = ?`).get(appId) as {
        n: number;
      };
      expect(n.n).toBe(0);
    }
  });

  it('deleting a user removes its group memberships and sessions', () => {
    const { users, groups, sessions, db } = ctx.store;
    const alice = users.getByUpn('alice@entralocal.dev')!;
    sessions.create({ userId: alice.id, expiresAt: FIXED_NOW + 3600 });
    expect(groups.listGroupsForUser(alice.id).length).toBeGreaterThan(0);

    expect(users.delete(alice.id)).toBe(true);
    const gm = db
      .prepare('SELECT COUNT(*) AS n FROM group_members WHERE user_id = ?')
      .get(alice.id) as { n: number };
    const ss = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(alice.id) as {
      n: number;
    };
    expect(gm.n).toBe(0);
    expect(ss.n).toBe(0);
  });
});

describe('auth codes single-use (criterion 6)', () => {
  it('consume succeeds once and fails on replay (atomic)', () => {
    const { authCodes } = ctx.store;
    const alice = ctx.store.users.getByUpn('alice@entralocal.dev')!;
    authCodes.insert({
      code: 'abc123',
      appId: 'cccccccc-0000-0000-0000-000000000001',
      userId: alice.id,
      redirectUri: 'https://localhost:3000',
      scopes: 'openid profile',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      expiresAt: FIXED_NOW + 300,
    });

    const first = authCodes.consume('abc123');
    expect(first?.consumed).toBe(true);
    expect(first?.userId).toBe(alice.id);
    expect(authCodes.consume('abc123')).toBeUndefined();
    expect(authCodes.consume('does-not-exist')).toBeUndefined();
  });

  it('deleteExpired removes only expired codes', () => {
    const { authCodes } = ctx.store;
    const alice = ctx.store.users.getByUpn('alice@entralocal.dev')!;
    const base = {
      appId: 'cccccccc-0000-0000-0000-000000000001',
      userId: alice.id,
      redirectUri: 'https://localhost:3000',
      scopes: 'openid',
    };
    authCodes.insert({ ...base, code: 'old', expiresAt: FIXED_NOW - 1 });
    authCodes.insert({ ...base, code: 'fresh', expiresAt: FIXED_NOW + 300 });
    expect(authCodes.deleteExpired(FIXED_NOW)).toBe(1);
    expect(authCodes.getByCode('old')).toBeUndefined();
    expect(authCodes.getByCode('fresh')).toBeDefined();
  });
});

describe('refresh tokens hashed + rotation (criterion 7)', () => {
  it('stores the SHA-256 hash as PK and looks up by derived hash; revoke/rotate behave', () => {
    const { refreshTokens } = ctx.store;
    const alice = ctx.store.users.getByUpn('alice@entralocal.dev')!;
    const base = {
      appId: 'cccccccc-0000-0000-0000-000000000001',
      userId: alice.id,
      scopes: 'openid offline_access',
      expiresAt: FIXED_NOW + 86400,
    };

    const stored = refreshTokens.insert({ ...base, token: 'plain-token-1' });
    expect(stored.tokenHash).toBe(sha256('plain-token-1'));
    // The plaintext is never persisted as the PK.
    const rawPk = ctx.db
      .prepare('SELECT token FROM refresh_tokens WHERE token = ?')
      .get(sha256('plain-token-1')) as { token: string };
    expect(rawPk.token).toBe(sha256('plain-token-1'));
    expect(refreshTokens.getByHash(sha256('plain-token-1'))?.userId).toBe(alice.id);

    // Rotation: revokes old + issues a chained new token atomically.
    const rotated = refreshTokens.rotate(sha256('plain-token-1'), {
      ...base,
      token: 'plain-token-2',
    });
    expect(rotated?.rotatedFrom).toBe(sha256('plain-token-1'));
    expect(refreshTokens.getByHash(sha256('plain-token-1'))?.revoked).toBe(true);
    // Replaying the already-revoked token fails to rotate again.
    expect(
      refreshTokens.rotate(sha256('plain-token-1'), { ...base, token: 'plain-token-3' }),
    ).toBeUndefined();

    // getByHash returns revoked rows (reuse detection is #7's job).
    expect(refreshTokens.revoke(sha256('plain-token-2'))).toBe(true);
    expect(refreshTokens.getByHash(sha256('plain-token-2'))?.revoked).toBe(true);
  });

  it('revokeFamily revokes the whole rotation chain (ancestors + descendants) but not siblings', () => {
    const { refreshTokens } = ctx.store;
    const alice = ctx.store.users.getByUpn('alice@entralocal.dev')!;
    const base = {
      appId: 'cccccccc-0000-0000-0000-000000000001',
      userId: alice.id,
      scopes: 'openid offline_access',
      expiresAt: FIXED_NOW + 86400,
    };

    // Chain 1: A → B → C (linear rotation chain).
    refreshTokens.insert({ ...base, token: 'fam-a' });
    refreshTokens.insert({ ...base, token: 'fam-b', rotatedFrom: sha256('fam-a') });
    refreshTokens.insert({ ...base, token: 'fam-c', rotatedFrom: sha256('fam-b') });
    // Chain 2: an independent sign-in (separate root) for the same user+app.
    refreshTokens.insert({ ...base, token: 'other-root' });

    // Reuse detected at the middle of chain 1 → revoke ancestors + descendants of THIS chain.
    const revoked = refreshTokens.revokeFamily(sha256('fam-b'));
    expect(revoked).toBe(3);
    expect(refreshTokens.getByHash(sha256('fam-a'))?.revoked).toBe(true);
    expect(refreshTokens.getByHash(sha256('fam-b'))?.revoked).toBe(true);
    expect(refreshTokens.getByHash(sha256('fam-c'))?.revoked).toBe(true);
    // The independent chain is unaffected.
    expect(refreshTokens.getByHash(sha256('other-root'))?.revoked).toBe(false);
  });
});

describe('signing keys + reset preservation (criterion 8)', () => {
  it('reset({reseed:true}) empties data, restores seed, and preserves the active kid', () => {
    const { signingKeys, users } = ctx.store;
    signingKeys.insert({
      kid: 'test-kid-1',
      tenantId: TEST_TENANT_ID,
      publicJwk: '{"kty":"RSA"}',
      privatePkcs8: 'PRIVATE',
    });
    // Add stray runtime data that reset must clear.
    users.create({
      tenantId: TEST_TENANT_ID,
      userPrincipalName: 'temp@entralocal.dev',
      displayName: 'T',
    });
    expect(users.count()).toBe(3);

    ctx.store.reset({ reseed: true });

    // Seed restored (exactly the two seeded users), stray user gone.
    expect(users.count()).toBe(2);
    expect(users.getByUpn('temp@entralocal.dev')).toBeUndefined();
    expect(users.getByUpn('alice@entralocal.dev')).toBeDefined();
    // Active signing key preserved.
    expect(signingKeys.getActive(TEST_TENANT_ID)?.kid).toBe('test-kid-1');
  });

  it('reset({resetKeys:true}) also drops signing keys', () => {
    const { signingKeys } = ctx.store;
    signingKeys.insert({
      kid: 'test-kid-2',
      tenantId: TEST_TENANT_ID,
      publicJwk: '{"kty":"RSA"}',
      privatePkcs8: 'PRIVATE',
    });
    ctx.store.reset({ reseed: true, resetKeys: true });
    expect(signingKeys.getActive(TEST_TENANT_ID)).toBeUndefined();
  });

  it('setActive makes a single key the active signer', () => {
    const { signingKeys } = ctx.store;
    signingKeys.insert({
      kid: 'k1',
      tenantId: TEST_TENANT_ID,
      publicJwk: '{}',
      privatePkcs8: 'p1',
    });
    signingKeys.insert({
      kid: 'k2',
      tenantId: TEST_TENANT_ID,
      publicJwk: '{}',
      privatePkcs8: 'p2',
    });
    expect(signingKeys.getActive(TEST_TENANT_ID)?.kid).toBe('k2'); // last insert active
    expect(signingKeys.setActive('k1', TEST_TENANT_ID)).toBe(true);
    expect(signingKeys.getActive(TEST_TENANT_ID)?.kid).toBe('k1');
    expect(signingKeys.listPublic(TEST_TENANT_ID)).toHaveLength(2);
    expect(signingKeys.listPublic(TEST_TENANT_ID)[0]).not.toHaveProperty('privatePkcs8');
  });
});

describe('sessions repository (criterion 4)', () => {
  it('creates, reads, deletes, and prunes expired sessions', () => {
    const { sessions, users } = ctx.store;
    const alice = users.getByUpn('alice@entralocal.dev')!;
    const s = sessions.create({ userId: alice.id, expiresAt: FIXED_NOW + 60 });
    expect(sessions.get(s.id)?.userId).toBe(alice.id);
    sessions.create({ userId: alice.id, expiresAt: FIXED_NOW - 1 });
    expect(sessions.deleteExpired(FIXED_NOW)).toBe(1);
    expect(sessions.delete(s.id)).toBe(true);
    expect(sessions.get(s.id)).toBeUndefined();
  });
});
