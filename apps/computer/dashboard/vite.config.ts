import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/dashboard/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/sessions": "http://localhost:19450",
      "/screenshot": "http://localhost:19450",
      "/stats": "http://localhost:19450",
      "/health": "http://localhost:19450",
      "/run": "http://localhost:19450",
      "/action": "http://localhost:19450",
    },
  },
});
