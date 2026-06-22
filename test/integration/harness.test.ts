import { existsSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/buildTestApp.js';
import { TMP_DIR } from '../helpers/constants.js';

describe('buildTestApp boot helper (criterion 10)', () => {
  it('returns an injectable app and a unique ephemeral dbPath', async () => {
    const ctx = await buildTestApp();
    try {
      expect(ctx.dbPath.startsWith(TMP_DIR)).toBe(true);
      expect(ctx.dbPath.endsWith('.db')).toBe(true);
      const res = await ctx.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    } finally {
      await ctx.close();
    }
  });

  it('close() removes the dbPath file', async () => {
    const ctx = await buildTestApp();
    // #1 does not open the DB; simulate a created file to prove cleanup.
    expect(existsSync(dirname(ctx.dbPath))).toBe(true);
    writeFileSync(ctx.dbPath, 'x');
    expect(existsSync(ctx.dbPath)).toBe(true);
    await ctx.close();
    expect(existsSync(ctx.dbPath)).toBe(false);
  });

  it('two concurrent buildTestApp() calls use distinct DB files', async () => {
    const [a, b] = await Promise.all([buildTestApp(), buildTestApp()]);
    try {
      expect(a.dbPath).not.toBe(b.dbPath);
      // Both apps are independently injectable.
      const [ra, rb] = await Promise.all([
        a.inject({ method: 'GET', url: '/health' }),
        b.inject({ method: 'GET', url: '/health' }),
      ]);
      expect(ra.statusCode).toBe(200);
      expect(rb.statusCode).toBe(200);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });
});
