import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const required = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/cli/index.js",
  "dist/cli/index.d.ts",
  "dist/mcp/index.js",
  "dist/mcp/index.d.ts",
];

const missing = required.filter((file) => !existsSync(join(process.cwd(), file)));

if (missing.length > 0) {
  console.error(`Missing dist files: ${missing.join(", ")}`);
  process.exit(1);
}

const distIndex = pathToFileURL(join(process.cwd(), "dist/index.js")).href;
const { listProviders } = (await import(distIndex)) as { listProviders: () => unknown[] };
const providers = listProviders();

if (!Array.isArray(providers) || providers.length !== 4) {
  console.error("Expected four provider capability cards in dist export.");
  process.exit(1);
}

console.log("dist smoke passed");
