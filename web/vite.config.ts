// Vite 7 without @vitejs/plugin-react: esbuild's automatic JSX runtime handles .tsx.
// Static output with relative asset URLs so the build works on any static host path
// (routing is hash-based, so no server rewrites are needed).
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  esbuild: { jsx: "automatic" },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2022",
    assetsInlineLimit: 0,
  },
  server: { host: "127.0.0.1", strictPort: true, port: 5173 },
  preview: { host: "127.0.0.1", strictPort: true, port: 4173 },
});
