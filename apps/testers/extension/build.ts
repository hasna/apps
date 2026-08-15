// Extension build script — compiles TypeScript to JS for Chrome.
// Uses bun build for each entry point.

import { $ } from "bun";

const outDir = "dist";

console.log("Building extension...");

await Promise.all([
  // Background service worker (ES module for MV3)
  $`bun build src/background/session.ts --outdir ${outDir}/background --target browser --external chrome --format esm`,

  // Content script (plain JS, runs in page context)
  $`bun build src/content/capture.ts --outdir ${outDir}/content --target browser --external chrome --format iife`,

  // Popup script
  $`bun build src/popup/popup.ts --outdir dist/popup --target browser --external chrome --format iife`,
]);

console.log("Extension built successfully.");
