import { TEST_TENANT_ID } from './constants.js';

/**
 * Shared deterministic fixtures. Seed data (users, groups, app registrations) with fixed GUIDs
 * lands in #2; this file holds the cross-feature constants tests can rely on today.
 */
export const FIXTURES = {
  tenantId: TEST_TENANT_ID,
  tenantAliases: ['common', 'organizations', 'consumers'] as const,
  /** A tenant segment that must never be allowlisted. */
  invalidTenant: 'badtenant',
} as const;
