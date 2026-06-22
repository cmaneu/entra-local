import { describe, expect, it } from 'vitest';
import { isReservedApiPath } from '../../src/http/pathmap.js';
import { isAllowedTenant, tenantAllowlist } from '../../src/http/tenant.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';
import { FIXTURES } from '../helpers/fixtures.js';

describe('isReservedApiPath', () => {
  it('treats /health and reserved prefixes as API', () => {
    expect(isReservedApiPath('/health')).toBe(true);
    expect(isReservedApiPath('/graph/v1.0/me')).toBe(true);
    expect(isReservedApiPath('/admin/api/users')).toBe(true);
  });

  it('treats tenant-shaped OIDC/OAuth paths as API (even unknown tenants)', () => {
    expect(isReservedApiPath('/common/v2.0/.well-known/openid-configuration')).toBe(true);
    expect(isReservedApiPath('/badtenant/oauth2/v2.0/authorize')).toBe(true);
    expect(isReservedApiPath('/anything/discovery/v2.0/keys')).toBe(true);
  });

  it('treats SPA routes as non-API', () => {
    expect(isReservedApiPath('/')).toBe(false);
    expect(isReservedApiPath('/some/portal/route')).toBe(false);
    expect(isReservedApiPath('/healthcheck')).toBe(false);
    expect(isReservedApiPath('/graphical')).toBe(false);
  });

  it('ignores the query string', () => {
    expect(isReservedApiPath('/health?probe=1')).toBe(true);
    expect(isReservedApiPath('/portal?x=1')).toBe(false);
  });
});

describe('tenant allowlist', () => {
  it('includes the tenant GUID plus the literal aliases', () => {
    expect(tenantAllowlist(TEST_TENANT_ID)).toEqual([
      TEST_TENANT_ID,
      'common',
      'organizations',
      'consumers',
    ]);
  });

  it('accepts allowlisted values and rejects others', () => {
    expect(isAllowedTenant(TEST_TENANT_ID, TEST_TENANT_ID)).toBe(true);
    for (const alias of FIXTURES.tenantAliases) {
      expect(isAllowedTenant(alias, TEST_TENANT_ID)).toBe(true);
    }
    expect(isAllowedTenant(FIXTURES.invalidTenant, TEST_TENANT_ID)).toBe(false);
    expect(isAllowedTenant('22222222-2222-2222-2222-222222222222', TEST_TENANT_ID)).toBe(false);
  });
});
