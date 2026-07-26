/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string;
  /** Local-only session token; bypasses the Telegram handshake. */
  readonly VITE_DEV_TOKEN?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
