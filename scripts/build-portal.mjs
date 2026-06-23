// Real portal build step (feature #12).
//
// Builds the React + Vite + TypeScript admin portal into `portal/dist` as a SINGLE
// self-contained `index.html` (JS + CSS inlined via vite-plugin-singlefile). The emulator's
// SPA fallback (#1) serves that one file for `/` and every client-side deep link without any
// static-asset middleware or new server runtime dependency.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const configFile = fileURLToPath(new URL('../portal/vite.config.ts', import.meta.url));
const indexHtml = fileURLToPath(new URL('../portal/dist/index.html', import.meta.url));

await build({ configFile, logLevel: 'info' });

if (!existsSync(indexHtml)) {
  console.error(`[build:portal] Vite build did not produce ${indexHtml}`);
  process.exit(1);
}

console.log('[build:portal] Portal built to portal/dist/index.html (single-file).');
