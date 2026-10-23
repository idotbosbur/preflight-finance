// Vite 7 without @vitejs/plugin-react: esbuild's automatic JSX runtime handles .tsx.
// Static output with relative asset URLs so the build works on any static host path
// (routing is hash-based, so no server rewrites are needed).
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  esbuild: { jsx: "automatic" },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2022",
    assetsInlineLimit: 0,
    rollupOptions: {
      input: Object.fromEntries(
        ["index", "privacy", "terms", "companies", "pilot-guide"].map((n) => [n, resolve(import.meta.dirname, `${n}.html`)]),
      ),
    },
  },
  server: { host: "127.0.0.1", strictPort: true, port: 5173 },
  preview: { host: "127.0.0.1", strictPort: true, port: 4173 },
});
