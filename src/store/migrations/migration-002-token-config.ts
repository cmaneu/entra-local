/**
 * Migration 002 — app-registration token configuration (optional claims + group claims).
 *
 * Adds three nullable columns to `app_registrations` so existing registrations keep working with
 * no data migration (acceptance criterion: "existing app registrations continue to work"):
 * - `optional_claims`          TEXT — JSON `{ idToken?: OptionalClaim[], accessToken?: OptionalClaim[] }`.
 * - `group_membership_claims`  TEXT — one of `None|SecurityGroup|DirectoryRole|ApplicationGroup|All`.
 * - `group_overage_limit`      INTEGER — per-app override of the global group overage limit.
 *
 * The JSON blob deliberately preserves *unsupported* optional claims verbatim (they are stored but
 * never emitted), so a future emulator version can support them without data loss.
 */
export const MIGRATION_002_TOKEN_CONFIG = `
ALTER TABLE app_registrations ADD COLUMN optional_claims TEXT;
ALTER TABLE app_registrations ADD COLUMN group_membership_claims TEXT NOT NULL DEFAULT 'None';
ALTER TABLE app_registrations ADD COLUMN group_overage_limit INTEGER;
`;
