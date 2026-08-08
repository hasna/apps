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

function binaryOperationNames(spec: typeof openapiSpec): Set<string> {
  const names = new Set<string>();
  for (const pathItem of Object.values(spec.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (!operation || typeof operation !== "object" || !("operationId" in operation)) continue;
      const responses = "responses" in operation ? operation.responses : undefined;
      if (!responses || typeof responses !== "object") continue;
      const hasBinarySuccess = Object.entries(responses).some(([status, response]) => {
        if (!status.startsWith("2") || !response || typeof response !== "object" || !("content" in response)) {
          return false;
        }
        const content = response.content;
        if (!content || typeof content !== "object") return false;
        return Object.values(content).some((media) => {
          if (!media || typeof media !== "object" || !("schema" in media)) return false;
          const schema = media.schema;
          return !!schema && typeof schema === "object" &&
            "type" in schema && schema.type === "string" &&
            "format" in schema && schema.format === "binary";
        });
      });
      if (hasBinarySuccess && typeof operation.operationId === "string") {
        names.add(operation.operationId);
      }
    }
  }
  return names;
}

function withBinaryResponses(
  code: string,
  binaryNames: Set<string>,
  operations: Array<{ operationId: string; functionName: string }>,
): string {
  if (binaryNames.size === 0) return code;

  let transformed = code
    .replace(
      "opts: { body?: unknown; query?: Record<string, unknown>; init?: RequestInit }",
      'opts: { body?: unknown; query?: Record<string, unknown>; init?: RequestInit; responseType?: "json" | "arrayBuffer" }',
    )
    .replace(
      "    const text = await response.text();",
      '    if (response.ok && opts.responseType === "arrayBuffer") {\n' +
        "      return await response.arrayBuffer() as T;\n" +
        "    }\n" +
        "    const text = await response.text();",
    );

  for (const operation of operations) {
    if (!binaryNames.has(operation.operationId)) continue;
    const marker = `    async ${operation.functionName}(`;
    const start = transformed.indexOf(marker);
    if (start < 0) {
      throw new Error(`Generated SDK is missing binary operation ${operation.operationId}.`);
    }
    const end = transformed.indexOf("\n    }", start);
    if (end < 0) {
      throw new Error(`Generated SDK method ${operation.functionName} has no closing boundary.`);
    }
    let method = transformed.slice(start, end + "\n    }".length);
    method = method
      .replace("): Promise<void> {", "): Promise<ArrayBuffer> {")
      .replace(
        "        init,\n      });",
        '        init,\n        responseType: "arrayBuffer",\n      });',
      );
    if (!method.includes("Promise<ArrayBuffer>") || !method.includes('responseType: "arrayBuffer"')) {
      throw new Error(`Generated SDK binary operation ${operation.operationId} did not transform safely.`);
    }
    transformed = transformed.slice(0, start) + method + transformed.slice(end + "\n    }".length);
  }

  return transformed;
}

const header =
  "// @generated from src/server/openapi.ts by scripts/generate-sdk.ts — DO NOT EDIT.\n" +
  "// Regenerate: bun run sdk:generate\n\n";

const generated = withBinaryResponses(
  withActionableErrors(result.code),
  binaryOperationNames(openapiSpec),
  result.operations,
).trimEnd();
const identityExport = 'export { IdentityError } from "../lib/identity.js";';
writeFileSync(join(outDir, "index.ts"), `${header}${generated}\n\n${identityExport}\n`);

console.log(`ok generated SDK -> src/sdk/index.ts (${result.operations.length} operations)`);
if (result.warnings.length) {
  console.log("warnings:\n  " + result.warnings.join("\n  "));
}
