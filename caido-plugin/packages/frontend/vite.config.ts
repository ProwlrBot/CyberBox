import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "ProwlrFrontend",
      fileName: () => "script.js",
      formats: ["iife"],
    },
    outDir: "../../dist/frontend",
    cssCodeSplit: false,
    rollupOptions: {
      external: ["@caido/sdk-frontend", "@caido/frontend-sdk"],
      output: {
        manualChunks: undefined,
        globals: {
          "@caido/sdk-frontend": "CaidoSDK",
          "@caido/frontend-sdk": "CaidoSDK",
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) return "style.css";
          return assetInfo.name || "asset";
        },
      },
    },
  },
});
