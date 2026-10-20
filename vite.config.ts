import { defineConfig } from "vite";

// Relative base so the build works from any sub-path (e.g. GitHub Pages /readygo/).
export default defineConfig({
  base: "./",
  server: { host: true, port: 5173, strictPort: true },
  build: { outDir: "dist", target: "es2020" },
});
