import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  define: { __BUILD_STAMP__: JSON.stringify(new Date().toISOString()) },
  test: { environment: "happy-dom" },
});
