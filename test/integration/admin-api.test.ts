import { afterEach, describe, expect, it } from 'vitest';
import { verifySecret } from '../../src/store/hashing.js';
import { SEED } from '../../src/store/seed.js';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';

/**
 * Integration tests for feature #11 — Admin REST API (`/admin/api/*`). Drives the routes in-process
 * via `app.inject`. Covers acceptance criteria 1–8 and 10 (criterion 9, the new-app sign-in
 * regression, lives in the auth-code e2e suite).
 */

const JSON_HEADERS = { 'content-type': 'application/json' };

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

interface ErrorBody {
  error: { code: string; message: string; target?: string; details?: { field: string }[] };
}

describe('Admin API — users CRUD (criterion 1)', () => {
  it('round-trips create/get/list/patch/delete with no password_hash leak', async () => {
    ctx = await buildTestApp();

    const create = await ctx.inject({
      method: 'POST',
      url: '/admin/api/users',
      headers: JSON_HEADERS,
      payload: {
        userPrincipalName: 'carol@entralocal.dev',
        displayName: 'Carol Example',
        mail: 'carol@entralocal.dev',
        password: 'Sup3r!Secret',
      },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as Record<string, unknown>;
    expect(created.id).toBeTruthy();
    expect(created.hasPassword).toBe(true);
    expect(created).not.toHaveProperty('password_hash');
    expect(created).not.toHaveProperty('password');
    expect(typeof created.createdAt).toBe('string');
    const id = created.id as string;

    // Create without a password → hasPassword false.
    const noPwd = await ctx.inject({
      method: 'POST',
      url: '/admin/api/users',
      headers: JSON_HEADERS,
      payload: { userPrincipalName: 'dave@entralocal.dev', displayName: 'Dave' },
    });
    expect((noPwd.json() as Record<string, unknown>).hasPassword).toBe(false);

    const get = await ctx.inject({ method: 'GET', url: `/admin/api/users/${id}` });
    expect(get.statusCode).toBe(200);
    expect((get.json() as Record<string, unknown>).userPrincipalName).toBe('carol@entralocal.dev');

    const list = await ctx.inject({ method: 'GET', url: '/admin/api/users' });
    expect(list.statusCode).toBe(200);
    const listed = list.json() as { value: { id: string }[]; count: number };
    expect(listed.value.some((u) => u.id === id)).toBe(true);

    const patch = await ctx.inject({
      method: 'PATCH',
      url: `/admin/api/users/${id}`,
      headers: JSON_HEADERS,
      payload: { displayName: 'Carol Renamed', password: null },
    });
    expect(patch.statusCode).toBe(200);
    const patched = patch.json() as Record<string, unknown>;
    expect(patched.displayName).toBe('Carol Renamed');
    expect(patched.hasPassword).toBe(false); // password cleared

    const del = await ctx.inject({ method: 'DELETE', url: `/admin/api/users/${id}` });
    expect(del.statusCode).toBe(204);
    const gone = await ctx.inject({ method: 'GET', url: `/admin/api/users/${id}` });
    expect(gone.statusCode).toBe(404);
  });

  it('duplicate userPrincipalName → 409 conflict; unknown id → 404 not_found', async () => {
    ctx = await buildTestApp();
    const dup = await ctx.inject({
      method: 'POST',
      url: '/admin/api/users',
      headers: JSON_HEADERS,
      payload: { userPrincipalName: 'alice@entralocal.dev', displayName: 'Clone' },
    });
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as ErrorBody).error.code).toBe('conflict');

    const unknown = await ctx.inject({ method: 'GET', url: '/admin/api/users/nope' });
    expect(unknown.statusCode).toBe(404);
    expect((unknown.json() as ErrorBody).error.code).toBe('not_found');
  });
});

describe('Admin API — validation (criterion 2)', () => {
  it('missing userPrincipalName + invalid mail → 400 with details[]', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'POST',
      url: '/admin/api/users',
      headers: JSON_HEADERS,
      payload: { displayName: 'X', mail: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as ErrorBody;
    expect(body.error.code).toBe('validation_error');
    const fields = (body.error.details ?? []).map((d) => d.field);
    expect(fields).toContain('userPrincipalName');
    expect(fields).toContain('mail');
  });
});

describe('Admin API — group membership (criterion 3)', () => {
  it('add/list/idempotent-add/remove members; non-existent user → 400 invalid_reference', async () => {
    ctx = await buildTestApp();
    const group = await ctx.inject({
      method: 'POST',
      url: '/admin/api/groups',
      headers: JSON_HEADERS,
      payload: { displayName: 'Squad', description: 'test squad' },
    });
    expect(group.statusCode).toBe(201);
    const groupId = (group.json() as { id: string }).id;

    const add = await ctx.inject({
      method: 'POST',
      url: `/admin/api/groups/${groupId}/members`,
      headers: JSON_HEADERS,
      payload: { userId: SEED.userAliceId },
    });
    expect(add.statusCode).toBe(204);

    const members = await ctx.inject({
      method: 'GET',
      url: `/admin/api/groups/${groupId}/members`,
    });
    expect(
      (members.json() as { value: { id: string }[] }).value.some((u) => u.id === SEED.userAliceId),
    ).toBe(true);

    // Idempotent re-add.
    const readd = await ctx.inject({
      method: 'POST',
      url: `/admin/api/groups/${groupId}/members`,
      headers: JSON_HEADERS,
      payload: { userId: SEED.userAliceId },
    });
    expect(readd.statusCode).toBe(204);
    expect(
      (await ctx.inject({ method: 'GET', url: `/admin/api/groups/${groupId}` })).json(),
    ).toMatchObject({ memberCount: 1 });

    const remove = await ctx.inject({
      method: 'DELETE',
      url: `/admin/api/groups/${groupId}/members/${SEED.userAliceId}`,
    });
    expect(remove.statusCode).toBe(204);

    const bad = await ctx.inject({
      method: 'POST',
      url: `/admin/api/groups/${groupId}/members`,
      headers: JSON_HEADERS,
      payload: { userId: 'ghost-user' },
    });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as ErrorBody).error.code).toBe('invalid_reference');
  });
});

describe('Admin API — app CRUD + sub-resources (criterion 4)', () => {
  it('creates app, sub-resources, cascade delete, and enforces appIdUri uniqueness', async () => {
    ctx = await buildTestApp();
    const create = await ctx.inject({
      method: 'POST',
      url: '/admin/api/apps',
      headers: JSON_HEADERS,
      payload: {
        displayName: 'My App',
        appIdUri: 'api://my-app',
        redirectUris: [{ uri: 'https://localhost:4000/cb', type: 'spa' }],
      },
    });
    expect(create.statusCode).toBe(201);
    const appId = (create.json() as { id: string }).id;

    // Duplicate redirect URI → 409.
    const dupRedirect = await ctx.inject({
      method: 'POST',
      url: `/admin/api/apps/${appId}/redirectUris`,
      headers: JSON_HEADERS,
      payload: { uri: 'https://localhost:4000/cb', type: 'spa' },
    });
    expect(dupRedirect.statusCode).toBe(409);

    const scope = await ctx.inject({
      method: 'POST',
      url: `/admin/api/apps/${appId}/scopes`,
      headers: JSON_HEADERS,
      payload: { value: 'access_as_user', adminConsentDisplayName: 'Access' },
    });
    expect(scope.statusCode).toBe(201);

    const role = await ctx.inject({
      method: 'POST',
      url: `/admin/api/apps/${appId}/roles`,
      headers: JSON_HEADERS,
      payload: { value: 'Tasks.Read.All', displayName: 'Read tasks' },
    });
    expect(role.statusCode).toBe(201);
    expect((role.json() as { allowedMemberTypes: string[] }).allowedMemberTypes).toEqual([
      'Application',
    ]);

    const full = await ctx.inject({ method: 'GET', url: `/admin/api/apps/${appId}` });
    const app = full.json() as {
      redirectUris: unknown[];
      exposedScopes: unknown[];
      appRoles: unknown[];
    };
    expect(app.redirectUris).toHaveLength(1);
    expect(app.exposedScopes).toHaveLength(1);
    expect(app.appRoles).toHaveLength(1);

    // appIdUri uniqueness on create + patch.
    const dupCreate = await ctx.inject({
      method: 'POST',
      url: '/admin/api/apps',
      headers: JSON_HEADERS,
      payload: { displayName: 'Other', appIdUri: 'api://my-app' },
    });
    expect(dupCreate.statusCode).toBe(409);

    const other = await ctx.inject({
      method: 'POST',
      url: '/admin/api/apps',
      headers: JSON_HEADERS,
      payload: { displayName: 'Other2' },
    });
    const otherId = (other.json() as { id: string }).id;
    const dupPatch = await ctx.inject({
      method: 'PATCH',
      url: `/admin/api/apps/${otherId}`,
      headers: JSON_HEADERS,
      payload: { appIdUri: 'api://my-app' },
    });
    expect(dupPatch.statusCode).toBe(409);

    // Cascade delete.
    const del = await ctx.inject({ method: 'DELETE', url: `/admin/api/apps/${appId}` });
    expect(del.statusCode).toBe(204);
    const gone = await ctx.inject({ method: 'GET', url: `/admin/api/apps/${appId}` });
    expect(gone.statusCode).toBe(404);
    // Sub-resources gone (no orphan rows).
    expect(ctx.app.store.apps.listScopes(appId)).toHaveLength(0);
    expect(ctx.app.store.apps.listRedirectUris(appId)).toHaveLength(0);
  });
});

describe('Admin API — secret show-once (criterion 5)', () => {
  it('returns secretText once, then hint-only, hashed at rest, and authenticates', async () => {
    ctx = await buildTestApp();
    const created = await ctx.inject({
      method: 'POST',
      url: `/admin/api/apps/${SEED.appDaemonId}/secrets`,
      headers: JSON_HEADERS,
      payload: { displayName: 'CI secret', expiresInDays: 30 },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as {
      id: string;
      secretText: string;
      hint: string;
      expiresAt: string | null;
    };
    expect(body.secretText).toBeTruthy();
    expect(body.hint).toBeTruthy();
    expect(body.expiresAt).toBeTruthy();
    const secretText = body.secretText;

    // GET never returns secretText again.
    const app = await ctx.inject({ method: 'GET', url: `/admin/api/apps/${SEED.appDaemonId}` });
    const secrets = (app.json() as { secrets: Record<string, unknown>[] }).secrets;
    const persisted = secrets.find((s) => s.id === body.id)!;
    expect(persisted).toBeDefined();
    expect(persisted).not.toHaveProperty('secretText');
    expect(persisted.hint).toBe(body.hint);

    // Stored value is a hash, not the plaintext, and verifies.
    const row = ctx.app.store.db
      .prepare('SELECT secret_hash FROM app_secrets WHERE id = ?')
      .get(body.id) as { secret_hash: string };
    expect(row.secret_hash).not.toBe(secretText);
    expect(verifySecret(secretText, row.secret_hash)).toBe(true);
    expect(ctx.app.store.apps.verifySecret(SEED.appDaemonId, secretText)).toBe(true);
  });
});

describe('Admin API — pagination (criterion 6)', () => {
  it('top/skip page over seeded users with count/top/skip envelope', async () => {
    ctx = await buildTestApp();
    const page0 = await ctx.inject({ method: 'GET', url: '/admin/api/users?top=1&skip=0' });
    const p0 = page0.json() as {
      value: { id: string }[];
      count: number;
      top: number;
      skip: number;
    };
    expect(p0.value).toHaveLength(1);
    expect(p0.count).toBe(2);
    expect(p0.top).toBe(1);
    expect(p0.skip).toBe(0);

    const page1 = await ctx.inject({ method: 'GET', url: '/admin/api/users?top=1&skip=1' });
    const p1 = page1.json() as { value: { id: string }[]; skip: number };
    expect(p1.value).toHaveLength(1);
    expect(p1.skip).toBe(1);
    expect(p1.value[0]!.id).not.toBe(p0.value[0]!.id);
  });
});

describe('Admin API — seed (criterion 7)', () => {
  it('seeds an empty DB once; second no-force call is a no-op', async () => {
    ctx = await buildTestApp({ seedOnStart: false });
    expect(ctx.app.store.tenants.getDefault()).toBeUndefined();

    const first = await ctx.inject({ method: 'POST', url: '/admin/api/seed' });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { seeded: boolean }).seeded).toBe(true);
    expect(ctx.app.store.tenants.getDefault()?.id).toBe(TEST_TENANT_ID);
    expect(ctx.app.store.users.count()).toBe(2);

    const second = await ctx.inject({ method: 'POST', url: '/admin/api/seed' });
    expect((second.json() as { seeded: boolean }).seeded).toBe(false);
    expect(ctx.app.store.users.count()).toBe(2);
  });
});

describe('Admin API — reset (criterion 8)', () => {
  it('empties + restores seed, preserves tenant row and active kid, no FK violation', async () => {
    ctx = await buildTestApp();
    const kidBefore = ctx.app.store.signingKeys.getActive(TEST_TENANT_ID)?.kid;
    expect(kidBefore).toBeTruthy();

    // Add a stray user so we can prove the reset emptied the table.
    await ctx.inject({
      method: 'POST',
      url: '/admin/api/users',
      headers: JSON_HEADERS,
      payload: { userPrincipalName: 'stray@entralocal.dev', displayName: 'Stray' },
    });
    expect(ctx.app.store.users.count()).toBe(3);

    const reset = await ctx.inject({
      method: 'POST',
      url: '/admin/api/reset',
      headers: JSON_HEADERS,
      payload: { reseed: true },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({ reset: true, reseeded: true });

    expect(ctx.app.store.users.count()).toBe(2);
    expect(ctx.app.store.users.getByUpn('stray@entralocal.dev')).toBeUndefined();
    expect(ctx.app.store.tenants.getDefault()?.id).toBe(TEST_TENANT_ID);
    expect(ctx.app.store.signingKeys.getActive(TEST_TENANT_ID)?.kid).toBe(kidBefore);
  });
});

describe('Admin API — error envelope + health (criterion 10)', () => {
  it('error paths return the admin envelope; health mirrors /health', async () => {
    ctx = await buildTestApp();

    const notFound = await ctx.inject({ method: 'GET', url: '/admin/api/groups/nope' });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.headers['content-type']).toContain('application/json');
    const body = notFound.json() as ErrorBody;
    expect(body.error.code).toBe('not_found');
    expect(typeof body.error.message).toBe('string');

    const health = await ctx.inject({ method: 'GET', url: '/admin/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: 'ok', tenantId: TEST_TENANT_ID });
  });
});
