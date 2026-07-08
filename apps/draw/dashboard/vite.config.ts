import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// The dashboard demonstrates the @hasna/draw SDK straight from source. React is
// resolved from the dashboard's own node_modules (the SDK keeps react as an
// optional peer), and deduped so there is exactly one copy.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      { find: /^@hasna\/draw\/react$/, replacement: path.resolve(__dirname, "../src/react/index.ts") },
      { find: /^@hasna\/draw$/, replacement: path.resolve(__dirname, "../src/index.ts") },
    ],
  },
  server: { fs: { allow: [path.resolve(__dirname, "..")] } },
  build: { outDir: "dist", emptyOutDir: true },
});
