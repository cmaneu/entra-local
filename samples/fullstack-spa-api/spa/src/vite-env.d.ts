/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_EMULATOR_ORIGIN?: string;
  readonly VITE_TENANT_ID?: string;
  readonly VITE_CLIENT_ID?: string;
  readonly VITE_API_APP_ID?: string;
  readonly VITE_REDIRECT_URI?: string;
  readonly VITE_API_BASE?: string;
  readonly VITE_API_SCOPE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
