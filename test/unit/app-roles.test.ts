import { afterEach, describe, expect, it } from 'vitest';
import { rolesForMemberType } from '../../src/identity/appRoles.js';
import { SEED } from '../../src/store/seed.js';
import { buildTestStore, type TestStore } from '../helpers/buildTestStore.js';

/**
 * Unit tests for the shared app-role auto-grant filter (`src/identity/appRoles.ts`), which backs
 * both the client-credentials `Application` grant (#8) and the delegated `User` grant (#29).
 */

const DAEMON = SEED.appDaemonId;

let ts: TestStore;
afterEach(() => ts?.close());

describe('rolesForMemberType', () => {
  it('returns [] for a null resource app', () => {
    ts = buildTestStore();
    expect(rolesForMemberType(null, ts.store, 'User')).toEqual([]);
  });

  it('returns only enabled User-type role values for the resource app', () => {
    ts = buildTestStore();
    ts.store.seed();
    const app = ts.store.apps.getByAppId(DAEMON)!;
    ts.store.apps.addRole(DAEMON, {
      value: 'ROLE_ADMIN',
      allowedMemberTypes: 'User',
      isEnabled: true,
    });
    ts.store.apps.addRole(DAEMON, {
      value: 'Disabled.Role',
      allowedMemberTypes: 'User',
      isEnabled: false,
    });
    ts.store.apps.addRole(DAEMON, {
      value: 'Both.Member',
      allowedMemberTypes: 'Application,User',
      isEnabled: true,
    });
    const roles = rolesForMemberType(app, ts.store, 'User');
    expect(roles).toContain('ROLE_ADMIN');
    expect(roles).toContain('Both.Member'); // comma list includes User
    expect(roles).not.toContain('Disabled.Role');
    expect(roles).not.toContain(SEED.daemonRoleValue); // Application-only, excluded from User
  });

  it('returns only enabled Application-type role values (matches autoGrantedRoles behavior)', () => {
    ts = buildTestStore();
    ts.store.seed();
    const app = ts.store.apps.getByAppId(DAEMON)!;
    const roles = rolesForMemberType(app, ts.store, 'Application');
    expect(roles).toContain(SEED.daemonRoleValue);
  });
});
