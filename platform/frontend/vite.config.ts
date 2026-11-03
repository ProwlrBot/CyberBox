import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/app/",
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 4173, proxy: { "/api": "http://127.0.0.1:8787", "/health": "http://127.0.0.1:8787" } },
});
