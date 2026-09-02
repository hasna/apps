#!/usr/bin/env bun
/**
 * Generate the typed SDK client from the serve OpenAPI document.
 *
 * Source of truth: src/serve/openapi.ts. Output: sdk/src/generated.ts.
 * Run: bun run sdk:generate
 */

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateSdkFromOpenApi } from "@hasna/contracts/sdk";
import { buildOpenApiDocument } from "../src/serve/openapi.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

// Use a placeholder version — the generated file is source, not release-pinned.
const spec = buildOpenApiDocument("0.0.0");
const { code, operations, warnings } = generateSdkFromOpenApi(spec, {
  className: "AttachmentsApiClient",
  apiKeyHeader: "x-api-key",
});

const header = `// @generated from src/serve/openapi.ts by scripts/generate-sdk.ts — DO NOT EDIT.\n// Regenerate: bun run sdk:generate\n\n`;
const out = join(repoRoot, "sdk", "src", "generated.ts");
// The published Contracts generator predates the canonical HTTPS boundary.
// Fail closed if its template changes; do not invent a Contracts release.
let hardened = code;
const required = (before: string, after: string) => {
  if (!hardened.includes(before)) throw new Error("SDK template changed; review canonical security patch.");
  hardened = hardened.replace(before, after);
};
required('apiKey?: string;', 'apiKey: string;');
required('private readonly apiKey: string | undefined;', '#apiKey: string;');
required('this.apiKey = options.apiKey;', 'this.#apiKey = options.apiKey;');
required('if (this.apiKey) headers["x-api-key"] = this.apiKey;', 'for (const name of Object.keys(headers)) { if (/^(authorization|x-api-key)$/i.test(name)) throw new Error("Authentication header overrides are not supported."); } headers["x-api-key"] = this.#apiKey;');
required('this.baseHeaders = options.headers ?? {};', 'if (Object.keys(options.headers ?? {}).some(name => /^(authorization|x-api-key)$/i.test(name))) throw new Error("Authentication header overrides are not supported."); this.baseHeaders = { ...options.headers };');
required('if (!options.baseUrl) throw new Error("AttachmentsApiClient requires a baseUrl.");', 'validateSdkConfig(options.baseUrl, options.apiKey);');
required('{ ...opts.init, method, headers, body: payload }', '{ ...opts.init, method, headers, body: payload, redirect: "error" }');
required('failed: ${response.status}`, data)', 'failed: ${response.status}`, undefined)');
const validation = `
export function validateSdkConfig(url: string, key: string): void {
  if (typeof url !== "string" || typeof key !== "string" || !key || key !== key.trim() || /[\\s\\x00-\\x1f\\x7f]/.test(key)) throw new Error("Explicit HTTPS URL and API key required.");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Valid HTTPS API URL required."); }
  if (url !== url.trim() || parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("HTTPS API URL must not include credentials, query, or fragment.");
}
`;
writeFileSync(out, header + hardened + validation);

console.log(`Generated ${operations.length} operations -> sdk/src/generated.ts`);
for (const op of operations) console.log(`  ${op.method.toUpperCase().padEnd(6)} ${op.path} -> ${op.functionName}`);
if (warnings.length) {
  console.log("Warnings:");
  for (const w of warnings) console.log(`  - ${w}`);
}
