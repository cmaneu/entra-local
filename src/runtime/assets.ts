import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Runtime asset access (feature #17). The server reads exactly two non-code assets at runtime —
 * the single-file portal (`portal/dist/index.html`) and `package.json` (for the reported version).
 *
 * In the normal run targets (tsx/dev, the compiled `dist/`, Docker) those live on disk and are
 * resolved via each caller's `new URL('…', import.meta.url)` exactly as before. In the
 * single-executable (Node SEA) build they are embedded in the SEA blob and read via
 * `sea.getAsset(...)`. This module is the one place that branches between the two.
 */

interface SeaApi {
  isSea(): boolean;
  getAsset(key: string, encoding: 'utf8'): string;
}

// `undefined` = not yet probed, `null` = probed and not running as a SEA.
let probed: SeaApi | null | undefined;

/**
 * Resolve the `node:sea` API only when actually running inside a single executable. The require
 * is guarded (and the `isSea()` result cached) so plain Node/ESM/`dist`/Docker — where `node:sea`
 * may be importable but `isSea()` is false, or where importing it is undesirable — never treats
 * itself as a SEA and never throws.
 *
 * The SEA build bundles this module to CJS, where `import.meta.url` is empty (so `createRequire`
 * of it would throw) but a real `require` is in scope and resolves `node:sea`. Plain ESM (`dist`,
 * dev) has no `require`, so it falls back to `createRequire(import.meta.url)`.
 */
function resolveSea(): SeaApi | null {
  if (probed !== undefined) return probed;
  try {
    const req: NodeRequire =
      typeof require !== 'undefined' ? require : createRequire(import.meta.url);
    const sea = req('node:sea') as SeaApi;
    probed = sea.isSea() ? sea : null;
  } catch {
    probed = null;
  }
  return probed;
}

/** True only when running as a Node SEA single executable. */
export function isSea(): boolean {
  return resolveSea() !== null;
}

/**
 * Read a UTF-8 text asset. Inside a SEA, returns the asset embedded under `seaKey`; otherwise
 * reads the file at the URL produced by `fileUrl()` — a `() => new URL('…', import.meta.url)`
 * thunk from the caller, identical to the pre-#17 filesystem behaviour.
 *
 * The URL is resolved lazily (only on the non-SEA branch) on purpose: when this code is bundled
 * to CJS for the SEA build, `import.meta.url` is empty, so eagerly evaluating
 * `new URL('…', import.meta.url)` would throw. Inside a SEA the thunk is never called.
 */
export function readTextAsset(seaKey: string, fileUrl: () => URL): string {
  const sea = resolveSea();
  if (sea) {
    return sea.getAsset(seaKey, 'utf8');
  }
  return readFileSync(fileURLToPath(fileUrl()), 'utf8');
}
