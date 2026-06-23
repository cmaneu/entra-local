import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Real-MSAL end-to-end suite. Runs serially against a real listening HTTPS server
// (not fastify.inject). Browser flows (@azure/msal-browser via Playwright) are wired
// but gated behind E2E_BROWSER until feature #6 lands; see test/helpers/msalDrivers.ts.
export default defineConfig({
  resolve: {
    alias: {
      // See vitest.config.ts: Vite's bundled builtin allowlist predates `node:sqlite`.
      'node:sqlite': fileURLToPath(new URL('./test/helpers/nodeSqliteShim.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/e2e/**/*.e2e.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    environment: 'node',
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
