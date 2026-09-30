import { createHash } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/store/db.js';
import { runMigrations } from '../../src/store/migrations/index.js';
import { MIGRATION_001_INITIAL } from '../../src/store/migrations/migration-001-initial.js';
import { MIGRATION_002_TOKEN_CONFIG } from '../../src/store/migrations/migration-002-token-config.js';
import { SEED } from '../../src/store/seed.js';
import { createStore } from '../../src/store/store.js';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';

const APP = SEED.appSpaId;
const ALICE = SEED.userAliceId;
const BOB = SEED.userBobId;
const BASE = `/admin/api/apps/${APP}/roleAssignments`;
const TOKEN = `/${TEST_TENANT_ID}/oauth2/v2.0/token`;
const VERIFIER = 'local-test-pkce-verifier-with-at-least-forty-three-characters';
let ctx: TestApp;

beforeEach(async () => {
  ctx = await buildTestApp();
});
afterEach(async () => {
  await ctx.close();
});

async function addRole(value: string, allowedMemberTypes = ['User'], isEnabled = true) {
  const response = await ctx.inject({
    method: 'POST',
    url: `/admin/api/apps/${APP}/roles`,
    payload: { value, allowedMemberTypes, isEnabled },
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string }).id;
}

async function assign(roleId: string, userId: string = ALICE, url = BASE) {
  return ctx.inject({ method: 'POST', url, payload: { roleId, userId } });
}

async function exchange(fields: Record<string, string>) {
  const response = await ctx.inject({
    method: 'POST',
    url: TOKEN,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ client_id: APP, ...fields }).toString(),
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { id_token: string; access_token: string; refresh_token: string };
}

async function signIn(userId: string) {
  const path = `/${TEST_TENANT_ID}/oauth2/v2.0/authorize`;
  const query = new URLSearchParams({
    client_id: APP,
    response_type: 'code',
    redirect_uri: SEED.spaRedirectUri,
    scope: `openid profile offline_access api://${APP}/${SEED.spaScopeValue}`,
    code_challenge: createHash('sha256').update(VERIFIER).digest('base64url'),
    code_challenge_method: 'S256',
  });
  const page = await ctx.inject({ method: 'GET', url: `${path}?${query}` });
  expect(page.statusCode).toBe(200);
  const state = /name="__el_state" value="([^"]*)"/.exec(page.body)?.[1];
  if (!state) throw new Error('Missing signed authorize state');
  const login = await ctx.inject({
    method: 'POST',
    url: path,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ __el_state: state, __el_user: userId }).toString(),
  });
  expect(login.statusCode).toBe(302);
  const code = new URL(String(login.headers.location)).searchParams.get('code');
  if (!code) throw new Error('Missing authorization code');
  return exchange({
    grant_type: 'authorization_code',
    code,
    redirect_uri: SEED.spaRedirectUri,
    code_verifier: VERIFIER,
  });
}

async function verify(token: string, audience: string = APP) {
  const response = await ctx.inject({
    method: 'GET',
    url: `/${TEST_TENANT_ID}/discovery/v2.0/keys`,
  });
  expect(response.statusCode).toBe(200);
  const keys = createLocalJWKSet(response.json() as JSONWebKeySet);
  return (await jwtVerify(token, keys, { audience, issuer: ctx.config.issuer })).payload;
}

async function preview(userId: string, appId: string = APP) {
  const response = await ctx.inject({
    method: 'POST',
    url: `/admin/api/apps/${appId}/token-preview`,
    payload: { userId, tokenType: 'idToken' },
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { claims: Record<string, unknown> }).claims;
}

describe('direct user roles in ID tokens', () => {
  it('isolates users and client apps; refresh observes removal and preview matches signed tokens', async () => {
    const operator = await addRole('console.operator');
    const reader = await addRole('console.reader');
    expect((await assign(operator)).statusCode).toBe(204);
    expect((await assign(reader)).statusCode).toBe(204);
    const alice = await signIn(ALICE);
    expect((await verify(alice.id_token)).roles).toEqual(['console.operator', 'console.reader']);
    expect((await preview(ALICE)).roles).toEqual(['console.operator', 'console.reader']);
    const bob = await signIn(BOB);
    expect(await verify(bob.id_token)).not.toHaveProperty('roles');
    expect(await preview(BOB)).not.toHaveProperty('roles');

    const other = ctx.app.store.apps.create({
      tenantId: TEST_TENANT_ID,
      displayName: 'Other client',
    });
    const generated = await ctx.inject({
      method: 'POST',
      url: `/admin/api/apps/${other.appId}/token-generate`,
      payload: { userId: ALICE, tokenType: 'idToken' },
    });
    expect(generated.statusCode).toBe(200);
    expect(
      await verify((generated.json() as { token: string }).token, other.appId),
    ).not.toHaveProperty('roles');
    expect(await preview(ALICE, other.appId)).not.toHaveProperty('roles');

    const revoked = await ctx.inject({ method: 'DELETE', url: `${BASE}/${operator}/${ALICE}` });
    expect(revoked.statusCode).toBe(204);
    const refreshed = await exchange({
      grant_type: 'refresh_token',
      refresh_token: alice.refresh_token,
    });
    expect((await verify(refreshed.id_token)).roles).toEqual(['console.reader']);
    expect((await preview(ALICE)).roles).toEqual(['console.reader']);
    expect(
      (await ctx.inject({ method: 'DELETE', url: `${BASE}/${reader}/${ALICE}` })).statusCode,
    ).toBe(204);
    const empty = await exchange({
      grant_type: 'refresh_token',
      refresh_token: refreshed.refresh_token,
    });
    expect(await verify(empty.id_token)).not.toHaveProperty('roles');
  });

  it('lists and removes assignments idempotently, scopes deletion to the app, and preserves disabled grants', async () => {
    const role = await addRole('console.operator', ['User', 'Application']);
    expect((await assign(role)).statusCode).toBe(204);
    expect((await assign(role)).statusCode).toBe(204);
    expect((await assign(role, BOB)).statusCode).toBe(204);
    const list = await ctx.inject({ method: 'GET', url: `${BASE}?top=1&skip=1` });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({
      value: [{ roleId: role, userId: BOB }],
      count: 2,
      top: 1,
      skip: 1,
    });

    const disabled = await ctx.inject({
      method: 'PATCH',
      url: `/admin/api/apps/${APP}/roles/${role}`,
      payload: { isEnabled: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect((await assign(role)).statusCode).toBe(204);
    expect((await verify((await signIn(ALICE)).id_token)).roles).toEqual(['console.operator']);
    const other = ctx.app.store.apps.create({
      tenantId: TEST_TENANT_ID,
      displayName: 'Other client',
    });
    expect(
      (
        await ctx.inject({
          method: 'DELETE',
          url: `/admin/api/apps/${other.appId}/roleAssignments/${role}/${ALICE}`,
        })
      ).statusCode,
    ).toBe(204);
    expect((await preview(ALICE)).roles).toEqual(['console.operator']);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(
        (await ctx.inject({ method: 'DELETE', url: `${BASE}/${role}/${ALICE}` })).statusCode,
      ).toBe(204);
    }
    expect(await preview(ALICE)).not.toHaveProperty('roles');
    expect((await assign(role)).statusCode).toBe(400);
  });

  it('rejects malformed bodies, missing parents, foreign references and ineligible roles', async () => {
    const role = await addRole('console.operator');
    const other = ctx.app.store.apps.create({
      tenantId: TEST_TENANT_ID,
      displayName: 'Other client',
    });
    const foreign = ctx.app.store.apps.addRole(other.appId, {
      value: 'foreign',
      allowedMemberTypes: 'User',
    });
    const disabled = await addRole('disabled', ['User'], false);
    const application = await addRole('application', ['Application']);
    ctx.app.store.tenants.upsert({
      id: 'other-tenant',
      displayName: 'Other',
      issuer: 'http://localhost/other',
    });
    const outsider = ctx.app.store.users.create({
      tenantId: 'other-tenant',
      userPrincipalName: 'outsider@local.test',
      displayName: 'Outsider',
    });
    for (const [roleId, userId, code] of [
      ['missing', ALICE, 'invalid_reference'],
      [foreign.id, ALICE, 'invalid_reference'],
      [role, 'missing', 'invalid_reference'],
      [role, outsider.id, 'invalid_reference'],
      [disabled, ALICE, 'validation_error'],
      [application, ALICE, 'validation_error'],
    ]) {
      const response = await assign(roleId!, userId!);
      expect(response.statusCode).toBe(400);
      expect((response.json() as { error: { code: string } }).error.code).toBe(code);
    }
    expect((await ctx.inject({ method: 'POST', url: BASE, payload: {} })).statusCode).toBe(400);
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      const url = `/admin/api/apps/missing/roleAssignments${method === 'DELETE' ? '/role/user' : ''}`;
      expect(
        (
          await ctx.inject({
            method,
            url,
            ...(method === 'POST' ? { payload: { roleId: role, userId: ALICE } } : {}),
          })
        ).statusCode,
      ).toBe(404);
    }
    expect(await preview(ALICE)).not.toHaveProperty('roles');
  });

  it('persists on reopening and cleans assignments on role/user/app deletion and reset', async () => {
    const role = await addRole('console.operator');
    expect((await assign(role)).statusCode).toBe(204);
    const db = openDatabase(ctx.dbPath);
    const reopened = createStore(db, { tenantId: TEST_TENANT_ID, issuer: ctx.config.issuer });
    try {
      expect(reopened.roleAssignments.values(APP, ALICE)).toEqual(['console.operator']);
    } finally {
      reopened.close();
    }
    expect(
      (await ctx.inject({ method: 'DELETE', url: `/admin/api/apps/${APP}/roles/${role}` }))
        .statusCode,
    ).toBe(204);
    expect(await preview(ALICE)).not.toHaveProperty('roles');
    const replacement = await addRole('console.reader');
    expect((await assign(replacement)).statusCode).toBe(204);
    expect(
      (await ctx.inject({ method: 'DELETE', url: `/admin/api/users/${ALICE}` })).statusCode,
    ).toBe(204);
    expect(ctx.app.store.roleAssignments.count(APP)).toBe(0);
    expect((await assign(replacement, BOB)).statusCode).toBe(204);
    expect((await ctx.inject({ method: 'DELETE', url: `/admin/api/apps/${APP}` })).statusCode).toBe(
      204,
    );
    expect(ctx.app.store.roleAssignments.count(APP)).toBe(0);
    ctx.app.store.reset();
    const final = await addRole('console.operator');
    expect((await assign(final)).statusCode).toBe(204);
    ctx.app.store.reset();
    expect(await preview(ALICE)).not.toHaveProperty('roles');
  });

  it('migrates a populated version-2 database without granting existing users any roles', () => {
    const db = openDatabase(':memory:');
    try {
      db.exec(MIGRATION_001_INITIAL);
      db.exec(MIGRATION_002_TOKEN_CONFIG);
      db.exec(
        'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL); INSERT INTO schema_migrations VALUES (1, 1), (2, 1);',
      );
      db.prepare('INSERT INTO tenants VALUES (?, ?, ?, ?)').run(
        TEST_TENANT_ID,
        'Local',
        ctx.config.issuer,
        1,
      );
      db.prepare(
        'INSERT INTO users (id, tenant_id, user_principal_name, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(ALICE, TEST_TENANT_ID, 'alice@entralocal.dev', 'Alice', 1);
      db.prepare(
        'INSERT INTO app_registrations (app_id, tenant_id, display_name, created_at) VALUES (?, ?, ?, ?)',
      ).run(APP, TEST_TENANT_ID, 'Client', 1);
      db.prepare(
        'INSERT INTO app_roles (id, app_id, value, allowed_member_types) VALUES (?, ?, ?, ?)',
      ).run('role', APP, 'console.operator', 'User');
      expect(runMigrations(db, () => 1)).toEqual([3]);
      const store = createStore(db, { tenantId: TEST_TENANT_ID, issuer: ctx.config.issuer });
      expect(store.users.getById(ALICE)?.displayName).toBe('Alice');
      expect(store.roleAssignments.values(APP, ALICE)).toEqual([]);
      store.roleAssignments.add('role', ALICE);
      expect(store.roleAssignments.values(APP, ALICE)).toEqual(['console.operator']);
      expect(runMigrations(db, () => 1)).toEqual([]);
    } finally {
      db.close();
    }
  });
});
