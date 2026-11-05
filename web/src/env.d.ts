declare const __BUILD_STAMP__: string;

interface ImportMetaEnv {
  readonly VITE_AI_ENDPOINT?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
