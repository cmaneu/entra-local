import { afterEach, describe, expect, it } from 'vitest';
import {
  autoGrantedRoles,
  resolveClientCredentialScope,
} from '../../src/identity/clientCredentials.js';
import { SEED } from '../../src/store/seed.js';
import { makeTestConfig } from '../helpers/constants.js';
import { buildTestStore, type TestStore } from '../helpers/buildTestStore.js';

/**
 * Unit tests for the #8 `.default`-scope resolution and app-role auto-grant helpers
 * (`src/identity/clientCredentials.ts`), independent of the HTTP layer.
 */

const CONFIG = makeTestConfig('./unused.db');
const DAEMON = SEED.appDaemonId;
const DAEMON_URI = `api://${DAEMON}`;

let ts: TestStore;
afterEach(() => ts?.close());

describe('resolveClientCredentialScope', () => {
  it('resolves the Graph .default to aud=GRAPH_RESOURCE_ID with no resource app', () => {
    ts = buildTestStore();
    ts.store.seed();
    const r = resolveClientCredentialScope(
      'https://graph.microsoft.com/.default',
      CONFIG,
      ts.store,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolved.aud).toBe(CONFIG.graphResourceId);
      expect(r.resolved.resourceApp).toBeNull();
    }
  });

  it('resolves an app_id_uri .default to aud=<uri string> + the resource app', () => {
    ts = buildTestStore();
    ts.store.seed();
    const r = resolveClientCredentialScope(`${DAEMON_URI}/.default`, CONFIG, ts.store);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolved.aud).toBe(DAEMON_URI);
      expect(r.resolved.resourceApp?.appId).toBe(DAEMON);
    }
  });

  it('resolves a GUID app_id .default to aud=<guid> + the resource app', () => {
    ts = buildTestStore();
    ts.store.seed();
    const r = resolveClientCredentialScope(`${DAEMON}/.default`, CONFIG, ts.store);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolved.aud).toBe(DAEMON);
      expect(r.resolved.resourceApp?.appId).toBe(DAEMON);
    }
  });

  it('rejects a missing/empty scope as invalid_request', () => {
    ts = buildTestStore();
    expect(resolveClientCredentialScope(undefined, CONFIG, ts.store)).toMatchObject({
      ok: false,
      error: 'invalid_request',
    });
    expect(resolveClientCredentialScope('   ', CONFIG, ts.store)).toMatchObject({
      ok: false,
      error: 'invalid_request',
    });
  });

  it('rejects multiple scopes (OIDC mixed in) as invalid_scope', () => {
    ts = buildTestStore();
    ts.store.seed();
    expect(
      resolveClientCredentialScope(`openid ${DAEMON_URI}/.default`, CONFIG, ts.store),
    ).toMatchObject({ ok: false, error: 'invalid_scope' });
  });

  it('rejects a non-.default scope as invalid_scope', () => {
    ts = buildTestStore();
    ts.store.seed();
    expect(
      resolveClientCredentialScope(`${DAEMON_URI}/access_as_user`, CONFIG, ts.store),
    ).toMatchObject({ ok: false, error: 'invalid_scope' });
  });

  it('rejects an unresolvable resource as invalid_scope', () => {
    ts = buildTestStore();
    expect(resolveClientCredentialScope('api://nope/.default', CONFIG, ts.store)).toMatchObject({
      ok: false,
      error: 'invalid_scope',
    });
  });
});

describe('autoGrantedRoles', () => {
  it('returns [] for a null resource app (Graph)', () => {
    ts = buildTestStore();
    expect(autoGrantedRoles(null, ts.store)).toEqual([]);
  });

  it('returns only enabled Application-type role values for the resource app', () => {
    ts = buildTestStore();
    ts.store.seed();
    const app = ts.store.apps.getByAppId(DAEMON)!;
    ts.store.apps.addRole(DAEMON, {
      value: 'Disabled.Role',
      allowedMemberTypes: 'Application',
      isEnabled: false,
    });
    ts.store.apps.addRole(DAEMON, {
      value: 'User.Only',
      allowedMemberTypes: 'User',
      isEnabled: true,
    });
    ts.store.apps.addRole(DAEMON, {
      value: 'Both.Member',
      allowedMemberTypes: 'Application,User',
      isEnabled: true,
    });
    const roles = autoGrantedRoles(app, ts.store);
    expect(roles).toContain(SEED.daemonRoleValue);
    expect(roles).toContain('Both.Member'); // comma list includes Application
    expect(roles).not.toContain('Disabled.Role');
    expect(roles).not.toContain('User.Only');
  });
});
