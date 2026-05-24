import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  root: "client",
  plugins: [
    react({ jsxRuntime: "classic" }),
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
