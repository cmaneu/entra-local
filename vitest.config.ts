import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Unit + integration + token-conformance suites (in-process, deterministic, no network) PLUS the
// portal component tests (#12). Server suites run in the `node` environment; portal `.test.tsx`
// files run in `jsdom` via `environmentMatchGlobs`. The real-MSAL e2e suite runs separately via
// vitest.e2e.config.ts.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Vite's bundled builtin allowlist predates `node:sqlite`; alias it to a shim that loads
      // the real builtin via Node's native require so the store layer is testable under vitest.
      'node:sqlite': fileURLToPath(new URL('./test/helpers/nodeSqliteShim.ts', import.meta.url)),
    },
  },
  test: {
    include: [
      'test/unit/**/*.test.ts',
      'test/integration/**/*.test.ts',
      'portal/src/**/*.test.{ts,tsx}',
    ],
    exclude: ['test/e2e/**', 'node_modules/**', 'dist/**', 'portal/dist/**'],
    environment: 'node',
    environmentMatchGlobs: [['portal/**', 'jsdom']],
    setupFiles: ['./portal/src/test/setup.ts'],
    globals: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
