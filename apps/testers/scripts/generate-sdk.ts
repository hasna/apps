#!/usr/bin/env bun
/**
 * Generate the typed HTTP SDK client from the served OpenAPI document using
 * @hasna/contracts' generator. Output: src/sdk/client.ts (committed).
 *
 *   bun run scripts/generate-sdk.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateSdkFromOpenApi } from "@hasna/contracts/sdk";
import { buildOpenApiDocument } from "../src/server/openapi.js";
import pkg from "../package.json";

const spec = buildOpenApiDocument(pkg.version);
const { code, operations, warnings } = generateSdkFromOpenApi(spec as never, {
  className: "TestersClient",
  apiKeyHeader: "x-api-key",
});

const out = join(import.meta.dir, "..", "src", "sdk", "client.ts");
const header = `// @generated from the testers OpenAPI document by scripts/generate-sdk.ts — DO NOT EDIT.\n// Regenerate: bun run scripts/generate-sdk.ts\n\n`;
writeFileSync(out, header + code);

console.log(`wrote src/sdk/client.ts (${operations.length} operations)`);
for (const op of operations) console.log(`  ${op.method.toUpperCase()} ${op.path} -> ${op.functionName}`);
if (warnings.length) {
  console.log("warnings:");
  for (const w of warnings) console.log(`  - ${w}`);
}
