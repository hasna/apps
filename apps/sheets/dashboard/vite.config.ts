import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The dashboard consumes @hasna/sheets exactly like an external app would, but
// resolves it from the freshly built dist so `bun run build:all` demonstrates
// the shipped artifacts end to end.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: "@hasna/sheets/react",
        replacement: fileURLToPath(new URL("../dist/react.js", import.meta.url)),
      },
      {
        find: "@hasna/sheets",
        replacement: fileURLToPath(new URL("../dist/index.js", import.meta.url)),
      },
    ],
  },
});
