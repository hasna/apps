#!/usr/bin/env bun
/**
 * Generate the typed SDK client from the serve OpenAPI document.
 * Emits src/sdk/index.ts — a dependency-free fetch client. Do not hand-edit
 * the generated file; re-run `bun run sdk:generate` after changing the spec.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateSdkFromOpenApi } from "@hasna/contracts/sdk";
import { openapiSpec } from "../src/server/openapi.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src", "sdk");
mkdirSync(outDir, { recursive: true });

const result = generateSdkFromOpenApi(openapiSpec as any, {
  className: "ConversationsClient",
  apiKeyHeader: "x-api-key",
});

// The shared generator intentionally widens single-value enums. For this
// cross-service append-only wire, preserve the schema discriminants as literal
// types so producer drift is rejected at compile time as well as at runtime.
let generatedCode = result.code;
for (const interfaceName of ["IncidentProjectionEventV1", "IncidentProjectionRecord"]) {
  const widened = new RegExp(`(export interface ${interfaceName} \\{[^\\n]*?)"schema_version": number; "source": string;`);
  const literal = new RegExp(`export interface ${interfaceName} \\{[^\\n]*?"schema_version": 1; "source": "todos";`);
  if (widened.test(generatedCode)) {
    generatedCode = generatedCode.replace(widened, '$1"schema_version": 1; "source": "todos";');
  } else if (!literal.test(generatedCode)) {
    throw new Error(`SDK generator output for ${interfaceName} no longer contains the expected discriminants`);
  }
}

const header =
  "// @generated from src/server/openapi.ts by scripts/generate-sdk.ts — DO NOT EDIT.\n" +
  "// Regenerate: bun run sdk:generate\n\n";

const outFile = join(outDir, "index.ts");
const generated = header + generatedCode;
if (process.argv.includes("--check")) {
  const current = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
  if (current !== generated) {
    console.error("generated SDK is stale; run: bun run sdk:generate");
    process.exit(1);
  }
  console.log(`ok generated SDK is current (${result.operations.length} operations)`);
  process.exit(0);
}

writeFileSync(outFile, generated);

console.log(`ok generated SDK -> src/sdk/index.ts (${result.operations.length} operations)`);
if (result.warnings.length) {
  console.log("warnings:\n  " + result.warnings.join("\n  "));
}
