// Prestart guard (feature #14): `npm start` runs the BUILT server, so fail fast with a clear,
// actionable message if `npm run build` hasn't produced the compiled entrypoint + portal asset
// yet — instead of a cryptic module-not-found / ENOENT at boot.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const required = [
  { path: new URL('../dist/index.js', import.meta.url), label: 'compiled server (dist/)' },
  {
    path: new URL('../portal/dist/index.html', import.meta.url),
    label: 'built admin portal (portal/dist/index.html)',
  },
];

const missing = required.filter(({ path }) => !existsSync(fileURLToPath(path)));

if (missing.length > 0) {
  const list = missing.map(({ label }) => `  - ${label}`).join('\n');
  process.stderr.write(
    `Cannot start: build output is missing:\n${list}\n\n` +
      `Run \`npm run build\` first (or use \`npm run dev\` for the source/reload workflow).\n`,
  );
  process.exit(1);
}
