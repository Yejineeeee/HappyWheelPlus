import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

const MAP_HOST = /^https:\/\/(tiles|api)\.openfreemap\.org\//;

export default defineConfig({
  base: "./",
  define: { __BUILD_STAMP__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icons/icon.svg"],
      manifest: {
        id: "./",
        name: "HappyWheel+",
        short_name: "HappyWheel+",
        description: "휠체어 이용자를 위한 접근성 여행 경로 안내",
        lang: "ko",
        theme_color: "#eef0f2",
        background_color: "#eef0f2",
        display: "standalone",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // 앱 셸만 미리 담는다. 데이터(약 100MB)는 쓸 때 담는다.
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        globIgnores: ["data/**", "og.png"],
        navigateFallbackDenylist: [/\/data\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // 글꼴은 쓰는 글자 조각만 받아 담는다(앱 셸에 미리 담지 않는다).
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/assets\/.*\.woff2$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "hw-fonts",
              expiration: { maxEntries: 120, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.includes("/data/"),
            handler: "CacheFirst",
            options: {
              cacheName: "hw-data",
              expiration: { maxEntries: 60, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }) => MAP_HOST.test(url.href),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "hw-map",
              expiration: { maxEntries: 300, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  test: { environment: "happy-dom", exclude: ["e2e/**", "node_modules/**", "dist/**"] },
});
