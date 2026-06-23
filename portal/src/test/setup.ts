import { afterEach } from 'vitest';

// This setup file runs for every vitest suite. Server suites use the `node` environment (no DOM),
// so the DOM-only wiring (jest-dom matchers + Testing Library auto-cleanup) is guarded behind a
// `document` check and only activates for the portal's jsdom suites.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());
}
