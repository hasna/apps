#!/usr/bin/env bun
/**
 * Regenerate src/sdk/client.ts from the domains-serve OpenAPI document.
 * Run: bun run sdk:gen
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSdkFromOpenApi } from "@hasna/contracts/sdk";
import { buildOpenApiSpec } from "../src/server/openapi.js";

const spec = buildOpenApiSpec("0.0.0");
const gen = generateSdkFromOpenApi(spec as never, {
  className: "DomainsClient",
  apiKeyHeader: "x-api-key",
});

const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "sdk", "client.ts");
writeFileSync(outPath, gen.code);
console.log(`✓ generated SDK (${gen.operations.length} operations) -> ${outPath}`);
if (gen.warnings.length) console.warn("warnings:", gen.warnings.join("; "));
