import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Resolves to <repo>/package.json from both src (tsx) and dist (built).
const PKG_PATH = fileURLToPath(new URL('../package.json', import.meta.url));

let cached: string | undefined;

/** The package version reported by `/health`. Read once and cached. */
export function appVersion(): string {
  if (cached === undefined) {
    const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8')) as { version?: string };
    cached = pkg.version ?? '0.0.0';
  }
  return cached;
}
