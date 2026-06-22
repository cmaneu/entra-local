import { defineConfig } from 'vitest/config';

// Unit + integration + token-conformance suites (in-process, deterministic, no network).
// The real-MSAL e2e suite runs separately via vitest.e2e.config.ts.
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
    exclude: ['test/e2e/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
    globals: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
