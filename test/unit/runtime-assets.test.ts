import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isSea, readTextAsset } from '../../src/runtime/assets.js';

/**
 * Asset indirection (#17). Under plain Node (the test runner, `dist`, Docker) the module must NOT
 * report itself as a SEA and must fall back to the existing `import.meta.url` filesystem read —
 * proving `version.ts`/`spaFallback.ts` keep working unchanged outside the single executable.
 */

const TMP_DIR = fileURLToPath(new URL('../../data/.tmp/', import.meta.url));

describe('#17 runtime asset indirection (non-SEA fallback)', () => {
  it('isSea() is false when not running as a single executable', () => {
    expect(isSea()).toBe(false);
  });

  it('readTextAsset() reads the file at the given import.meta.url-relative URL', () => {
    const dir = join(TMP_DIR, `assets-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'asset.txt');
    const content = `hello-${randomUUID()}`;
    writeFileSync(file, content, 'utf8');
    try {
      const url = pathToFileURL(file);
      expect(readTextAsset('some-key', () => url)).toBe(content);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves the real package.json version through the same path version.ts uses', () => {
    const pkgUrl = new URL('../../package.json', import.meta.url);
    const pkg = JSON.parse(readTextAsset('package-json', () => pkgUrl)) as { version?: string };
    const onDisk = JSON.parse(readFileSync(fileURLToPath(pkgUrl), 'utf8')) as { version?: string };
    expect(pkg.version).toBe(onDisk.version);
  });
});
