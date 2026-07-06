#!/usr/bin/env bun
/**
 * Generate the typed open-files SDK from the serve OpenAPI document using
 * @hasna/contracts. Output: src/sdk/client.ts (dependency-free fetch client).
 *
 * Run: bun run build:sdk
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateSdkFromOpenApi } from "@hasna/contracts/sdk";
import { openApiDocument } from "../src/server/openapi.js";

const { code, operations, warnings } = generateSdkFromOpenApi(openApiDocument as never, {
  className: "FilesClient",
  apiKeyHeader: "x-api-key",
});

const header = [
  "// @generated from src/server/openapi.ts by @hasna/contracts/sdk — DO NOT EDIT.",
  "// Regenerate: bun run build:sdk",
  "",
].join("\n");

const outDir = join(import.meta.dir, "..", "src", "sdk");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "client.ts"), header + code);

console.log(`Generated FilesClient SDK: ${operations.length} operations -> src/sdk/client.ts`);
if (warnings.length) console.warn(`warnings:\n  ${warnings.join("\n  ")}`);
