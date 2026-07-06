#!/usr/bin/env bun
/**
 * Generate the typed SDK client from the serve OpenAPI document.
 *
 * Source of truth: src/server/openapi.ts. Output: src/sdk/client.ts (a
 * dependency-free fetch client that speaks the Hasna auth convention,
 * x-api-key). Regenerate whenever the API surface changes.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateSdkFromOpenApi } from "@hasna/contracts/sdk";
import { buildOpenApiDocument } from "../src/server/openapi.js";
import { VERSION } from "../src/version.js";

const spec = buildOpenApiDocument(VERSION);
const { code, operations, warnings } = generateSdkFromOpenApi(spec, { className: "SecretsClient" });

const out = join(import.meta.dir, "..", "src", "sdk", "client.ts");
writeFileSync(out, code, "utf8");
console.log(`Generated ${operations.length} operations -> ${out}`);
if (warnings.length > 0) console.log("warnings:", warnings);
