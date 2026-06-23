import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password / secret hashing and opaque-token hashing helpers.
 *
 * - User passwords and app secrets are hashed with **scrypt** (`node:crypto`, no native dep),
 *   using a random per-hash salt and a self-describing encoded format. Verification is
 *   constant-time. Plaintext is never stored.
 * - Opaque high-entropy tokens (refresh tokens) are hashed with **SHA-256**: they are not
 *   low-entropy passwords, so a fast unsalted digest is sufficient and lets the hash double as
 *   a stable primary-key / lookup value.
 */

// scrypt cost parameters. N must be a power of two. 16384*8*128 bytes ≈ 16 MiB working set.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

/** Hash a password or secret with scrypt, returning a self-describing `scrypt$N$r$p$salt$hash`. */
export function hashPassword(plaintext: string): string {
  const salt = randomBytes(SALT_LEN);
  const derived = scryptSync(plaintext, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/** Constant-time verify of a plaintext against a stored scrypt hash. Returns false if malformed. */
export function verifyPassword(plaintext: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = scryptSync(plaintext, salt, expected.length, { N: n, r, p });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** App secrets share the password hashing scheme. */
export const hashSecret = hashPassword;
export const verifySecret = verifyPassword;

/** SHA-256 hex digest used to store opaque tokens (refresh tokens) hashed at rest. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
