import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const dir = fileURLToPath(new URL(".", import.meta.url));

// The dashboard consumes the built package output (run `bun run build` in the
// repo root first). Aliases resolve the package specifiers to ../dist.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@hasna/tables/react", replacement: resolve(dir, "../dist/react/index.js") },
      { find: "@hasna/tables", replacement: resolve(dir, "../dist/index.js") },
    ],
  },
  server: { port: 5173 },
});
