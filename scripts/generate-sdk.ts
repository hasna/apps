#!/usr/bin/env bun
// Generate the typed projects SDK from the serve OpenAPI document, using
// @hasna/contracts/sdk generateSdkFromOpenApi. Output: src/sdk/client.ts.
// Run: bun run scripts/generate-sdk.ts

import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSdkFromOpenApi } from "@hasna/contracts/sdk";
import { buildOpenApiSpec } from "../src/serve/openapi.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const version = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")).version || "0.0.0";

const spec = buildOpenApiSpec(version);
const { code, operations, warnings } = generateSdkFromOpenApi(spec as never, {
  className: "ProjectsClient",
  apiKeyHeader: "x-api-key",
});

// The shared generator currently makes every query object optional even when
// every query parameter in OpenAPI is required. Keep complete bounded reads
// impossible to call without their bounds until the generator owns this
// distinction directly.
const requiredBoundedReadMethods = [
  "guardedReadProject",
  "lookupGuardedProjectMutationReceipt",
  "readProjectResourceLinks",
  "readProjectResourceLinkMigration",
] as const;
let generatedCode = code;
for (const method of requiredBoundedReadMethods) {
  const signature = new RegExp(`(async ${method}\\([^)]*?), query\\?:`);
  if (!signature.test(generatedCode)) {
    throw new Error(`generated SDK is missing the expected bounded-read signature for ${method}`);
  }
  generatedCode = generatedCode.replace(signature, "$1, query:");
}

const banner = `// @generated from the projects-serve OpenAPI document by scripts/generate-sdk.ts.
// DO NOT EDIT BY HAND. Regenerate: bun run sdk:generate
`;
const outPath = join(repoRoot, "src", "sdk", "client.ts");
writeFileSync(outPath, banner + generatedCode);

console.error(`Generated ${operations.length} operations -> src/sdk/client.ts`);
if (warnings.length) console.error("Warnings:\n" + warnings.map((w) => `  - ${w}`).join("\n"));
