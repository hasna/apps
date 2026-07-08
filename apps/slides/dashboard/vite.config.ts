import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// The dashboard consumes the SDK directly from source so it always
// demonstrates the current headless model + React viewer.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: "@hasna/slides/react",
        replacement: path.resolve(__dirname, "../src/react/index.tsx"),
      },
      {
        find: "@hasna/slides",
        replacement: path.resolve(__dirname, "../src/index.ts"),
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  build: { outDir: "dist", emptyOutDir: true },
});
