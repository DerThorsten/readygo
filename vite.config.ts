import { defineConfig } from "vite";

// Relative base so the same build works on a web server, inside Capacitor and inside Tauri.
export default defineConfig({
  base: "./",
  server: { host: true, port: 5173, strictPort: true },
  build: { outDir: "dist", target: "es2020" },
});
