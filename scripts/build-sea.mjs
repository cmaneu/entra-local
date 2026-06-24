// Single-executable build (feature #17) — Node SEA flow.
//
// Produces a self-contained native binary that boots the full emulator with no Node install and
// no external files: the compiled server + all production npm deps are bundled into one CJS file
// (esbuild), the portal HTML and package.json are embedded as SEA assets, and the blob is injected
// into a copy of the running Node executable with postject.
//
// Prereq: `npm run build` (compiles dist/ + the single-file portal). Run: `npm run build:sea`.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inject } from 'postject';
import { readFile } from 'node:fs/promises';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT_DIR = join(ROOT, 'dist-sea');
const ENTRY = join(ROOT, 'dist', 'index.js');
const PORTAL = join(ROOT, 'portal', 'dist', 'index.html');
const BUNDLE = join(OUT_DIR, 'bundle.cjs');
const SEA_CONFIG = join(ROOT, 'sea-config.json');
const BLOB = join(OUT_DIR, 'sea-prep.blob');
// Stable sentinel fuse used by Node's SEA loader to locate the injected blob.
const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

/** Native executable name/extension for the current platform. */
function exeName() {
  return process.platform === 'win32' ? 'entra-local.exe' : 'entra-local';
}

function ensurePrereqs() {
  const missing = [];
  if (!existsSync(ENTRY)) missing.push('dist/index.js (compiled server)');
  if (!existsSync(PORTAL)) missing.push('portal/dist/index.html (built portal)');
  if (missing.length > 0) {
    process.stderr.write(
      `Cannot build SEA binary — build output is missing:\n` +
        missing.map((m) => `  - ${m}`).join('\n') +
        `\n\nRun \`npm run build\` first.\n`,
    );
    process.exit(1);
  }
}

async function bundleApp() {
  console.log('[build:sea] Bundling dist/index.js + production deps -> dist-sea/bundle.cjs …');
  await build({
    entryPoints: [ENTRY],
    outfile: BUNDLE,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // `node:`-prefixed builtins are external on platform=node; list the newer ones explicitly as
    // a safety belt so the embedded Node resolves them at runtime instead of esbuild bundling them.
    external: ['node:sqlite', 'node:sea'],
    logLevel: 'info',
  });
}

function generateBlob() {
  console.log('[build:sea] Generating SEA blob (embedding portal + package.json assets) …');
  execFileSync(process.execPath, ['--experimental-sea-config', SEA_CONFIG], {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

async function makeBinary() {
  const target = join(OUT_DIR, exeName());
  console.log(`[build:sea] Copying Node runtime -> ${target} …`);
  // Replace any prior binary so a stale signature/blob can't linger.
  rmSync(target, { force: true });
  copyFileSync(process.execPath, target);

  console.log('[build:sea] Injecting SEA blob with postject …');
  const blob = await readFile(BLOB);
  await inject(target, 'NODE_SEA_BLOB', blob, {
    sentinelFuse: SENTINEL_FUSE,
    machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined,
  });
  return target;
}

async function main() {
  ensurePrereqs();
  mkdirSync(OUT_DIR, { recursive: true });
  await bundleApp();
  generateBlob();
  const target = await makeBinary();
  const sizeMb = (statSync(target).size / (1024 * 1024)).toFixed(1);
  console.log(`\n[build:sea] Done. Binary: ${target} (${sizeMb} MB)`);
  console.log('[build:sea] It is UNSIGNED (dev tool) — run it directly to start the emulator.');
}

main().catch((err) => {
  process.stderr.write(`[build:sea] Failed: ${err?.stack ?? String(err)}\n`);
  process.exit(1);
});
