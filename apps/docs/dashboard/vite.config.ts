import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// The dashboard demonstrates the @hasna/docs SDK straight from source. React,
// react-dom, and @tiptap/* are resolved from the package's own node_modules so
// there is exactly one copy of each.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      { find: /^@hasna\/docs\/react$/, replacement: path.resolve(__dirname, "../src/react/index.ts") },
      { find: /^@hasna\/docs$/, replacement: path.resolve(__dirname, "../src/index.ts") },
      { find: /^react$/, replacement: path.resolve(__dirname, "../node_modules/react") },
      { find: /^react-dom$/, replacement: path.resolve(__dirname, "../node_modules/react-dom") },
      { find: /^react-dom\/client$/, replacement: path.resolve(__dirname, "../node_modules/react-dom/client") },
    ],
  },
  server: { fs: { allow: [path.resolve(__dirname, "..")] } },
  build: { outDir: "dist", emptyOutDir: true },
});
