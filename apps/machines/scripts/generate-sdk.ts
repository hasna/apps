#!/usr/bin/env bun
// Regenerate the typed SDK client from the machines-serve OpenAPI document.
//
//   bun run scripts/generate-sdk.ts
//
// Output: src/sdk/generated-client.ts (a dependency-free fetch client). The
// hand-written src/sdk/index.ts wraps it with an env-based factory.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSdkFromOpenApi } from "@hasna/contracts/sdk";
import { buildOpenApiDocument } from "../src/server/openapi.js";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "src", "sdk", "generated-client.ts");

const spec = buildOpenApiDocument();
const result = generateSdkFromOpenApi(spec, { className: "MachinesClient", apiKeyHeader: "x-api-key" });

writeFileSync(outPath, result.code, "utf8");
console.log(`wrote ${outPath}`);
console.log(`operations: ${result.operations.map((o) => o.functionName).join(", ")}`);
if (result.warnings.length) console.warn(`warnings:\n  ${result.warnings.join("\n  ")}`);
