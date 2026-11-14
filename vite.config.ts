import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 開発時は /api を wrangler dev (8787) にプロキシして、本番と同じ経路で叩けるようにする。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
  },
});
