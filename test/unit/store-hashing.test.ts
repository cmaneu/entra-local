import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  hashSecret,
  sha256,
  verifyPassword,
  verifySecret,
} from '../../src/store/hashing.js';

describe('hashing helpers (criterion 5 + 7)', () => {
  it('scrypt: verifies the correct password and rejects wrong ones', () => {
    const stored = hashPassword('Password1!');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(stored).not.toContain('Password1!');
    expect(verifyPassword('Password1!', stored)).toBe(true);
    expect(verifyPassword('wrong', stored)).toBe(false);
  });

  it('scrypt: uses a random salt so the same input yields different hashes', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('verifyPassword returns false for malformed/empty stored values', () => {
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', 'scrypt$0$0$0$$')).toBe(false);
  });

  it('secret hashing reuses the scrypt scheme', () => {
    const stored = hashSecret('s3cr3t-value');
    expect(stored).not.toContain('s3cr3t-value');
    expect(verifySecret('s3cr3t-value', stored)).toBe(true);
    expect(verifySecret('nope', stored)).toBe(false);
  });

  it('sha256 is deterministic, hex, and not the input', () => {
    const a = sha256('opaque-token');
    const b = sha256('opaque-token');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('opaque-token');
  });
});
