import { readTextAsset } from './runtime/assets.js';

let cached: string | undefined;

/** The package version reported by `/health`. Read once and cached. */
export function appVersion(): string {
  if (cached === undefined) {
    // Resolves to <repo>/package.json from src (tsx) and dist (built); inside a Node SEA single
    // executable (#17) the same content is read from the embedded `package-json` asset instead.
    const pkg = JSON.parse(
      readTextAsset('package-json', () => new URL('../package.json', import.meta.url)),
    ) as { version?: string };
    cached = pkg.version ?? '0.0.0';
  }
  return cached;
}
