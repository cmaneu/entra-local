import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-origin dev proxy targets (the running emulator). Override with EMULATOR_ORIGIN.
const target = process.env.EMULATOR_ORIGIN ?? 'https://localhost:8443';
const proxy = {
  target,
  changeOrigin: true,
  // The emulator serves a self-signed cert in dev; trust it for the proxy.
  secure: false,
};

/**
 * Vite build for the Entra Local admin portal.
 *
 * The production build is emitted as a SINGLE self-contained `index.html` (JS + CSS inlined via
 * vite-plugin-singlefile). The emulator's SPA fallback (#1) serves that one file for `/` and every
 * client-side deep link (`/apps/:id`) without any static-asset middleware or new server runtime
 * dependency. In dev, the Vite server proxies the emulator API surfaces for HMR.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Inline everything so the SPA fallback can serve a single index.html.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 100_000_000,
  },
  server: {
    proxy: {
      '/admin': proxy,
      '/health': proxy,
      '/graph': proxy,
      // Tenanted OIDC/OAuth endpoints (discovery is read by the MSAL snippet panel).
      '/common': proxy,
      '/organizations': proxy,
      '/consumers': proxy,
      '^/[0-9a-fA-F-]{36}/': proxy,
    },
  },
});
