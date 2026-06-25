import { defineConfig } from 'vite';

// The redirect URI registered for the SPA app (`…0004`) in the emulator seed is
// `http://localhost:5173`, so both `vite dev` and `vite preview` must bind that exact port.
// `strictPort` makes a port clash fail loudly instead of silently moving to another port (which
// would break redirect-URI matching).
export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
