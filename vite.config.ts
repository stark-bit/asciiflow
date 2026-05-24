import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  root: "client",
  plugins: [
    react({ jsxRuntime: "classic" }),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,png,svg}"],
      },
      manifest: {
        name: "ASCIIFlow",
        short_name: "ASCIIFlow",
        description: "Infinite ASCII diagrams, draw and export to text",
        theme_color: "#333333",
        background_color: "#333333",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable any",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: [
      {
        find: /^#asciiflow\/(.*)/,
        replacement: path.resolve(__dirname, "$1"),
      },
    ],
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
