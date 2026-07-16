#!/usr/bin/env bun
/**
 * Generate the typed SDK client from the serve OpenAPI document.
 * Emits src/sdk/index.ts — a dependency-free fetch client. Do not hand-edit
 * the generated file; re-run `bun run sdk:generate` after changing the spec.
 */

import { mkdirSync, writeFileSync } from "fs";
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

function withActionableErrors(code: string): string {
  const marker = "export class ConversationsClient {";
  const helper = `function apiErrorMessage(method: string, path: string, status: number, body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return \`\${method} \${path} failed: \${status}\`;
  }
  const record = body as Record<string, unknown>;
  const parts = [
    typeof record.error === "string" ? record.error : null,
    typeof record.field === "string" ? \`field=\${record.field}\` : null,
    typeof record.reason === "string" ? record.reason : null,
    typeof record.hint === "string" ? \`hint: \${record.hint}\` : null,
  ].filter(Boolean);
  return \`\${method} \${path} failed: \${status}\${parts.length ? \`: \${parts.join("; ")}\` : ""}\`;
}

`;

  return code
    .replace(marker, helper + marker)
    .replace(
      "throw new ApiError(response.status, `${method} ${path} failed: ${response.status}`, data);",
      "throw new ApiError(response.status, apiErrorMessage(method, path, response.status, data), data);",
    );
}

const header =
  "// @generated from src/server/openapi.ts by scripts/generate-sdk.ts — DO NOT EDIT.\n" +
  "// Regenerate: bun run sdk:generate\n\n";

writeFileSync(join(outDir, "index.ts"), header + withActionableErrors(result.code));

console.log(`ok generated SDK -> src/sdk/index.ts (${result.operations.length} operations)`);
if (result.warnings.length) {
  console.log("warnings:\n  " + result.warnings.join("\n  "));
}
