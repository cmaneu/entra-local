/**
 * Vite (bundled with our vitest version) ships a static Node builtins allowlist that predates
 * `node:sqlite`, so it strips the `node:` prefix and tries to resolve a non-existent `sqlite`
 * package. This shim — aliased to `node:sqlite` in vitest.config.ts only — loads the real builtin
 * via Node's native `require`, bypassing Vite's resolver. Production (`tsc`) imports the real
 * module directly and never sees this file.
 */
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

export const { DatabaseSync } = nodeRequire('node:sqlite');
