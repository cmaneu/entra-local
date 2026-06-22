// Placeholder portal build step for feature #1.
//
// The functional React + Vite portal is built in feature #12. For now, `npm run build`
// must succeed and leave the committed static placeholder at `portal/dist/index.html`
// in place (it is served by the SPA fallback). This script simply asserts the placeholder
// exists so the build contract is honored without a Vite project yet.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const placeholder = fileURLToPath(new URL('../portal/dist/index.html', import.meta.url));

if (!existsSync(placeholder)) {
  console.error(`[build:portal] Missing placeholder portal asset: ${placeholder}`);
  process.exit(1);
}

console.log('[build:portal] Placeholder portal present (real portal build lands in #12).');
