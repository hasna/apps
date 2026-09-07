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
const defaultOutputPath = join(root, "src", "sdk", "index.ts");

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

function textOperationNames(spec: typeof openapiSpec): Set<string> {
  const names = new Set<string>();
  for (const pathItem of Object.values(spec.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (!operation || typeof operation !== "object" || !("operationId" in operation)) continue;
      const responses = "responses" in operation ? operation.responses : undefined;
      if (!responses || typeof responses !== "object") continue;
      const hasTextSuccess = Object.entries(responses).some(([status, response]) => {
        if (!status.startsWith("2") || !response || typeof response !== "object" || !("content" in response)) {
          return false;
        }
        const content = response.content;
        if (!content || typeof content !== "object") return false;
        return Object.entries(content).some(([mediaType, media]) => {
          if (!mediaType.startsWith("text/") || !media || typeof media !== "object" || !("schema" in media)) {
            return false;
          }
          const schema = media.schema;
          return !!schema && typeof schema === "object" && "type" in schema && schema.type === "string";
        });
      });
      if (hasTextSuccess && typeof operation.operationId === "string") names.add(operation.operationId);
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
      '    if (response.ok && opts.responseType === "arrayBuffer" && !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {\n' +
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
    const signatureEnd = method.indexOf("\n");
    const returnStart = method.lastIndexOf("): Promise<", signatureEnd);
    const returnEnd = method.lastIndexOf("> {", signatureEnd);
    if (returnStart < 0 || returnEnd < returnStart) {
      throw new Error(`Generated SDK binary operation ${operation.operationId} has no safe return boundary.`);
    }
    const generatedReturn = method.slice(
      returnStart + "): Promise<".length,
      returnEnd,
    );
    const signaturePrefix = method.slice(0, returnStart);
    const base64Query = 'query?: { "encoding"?: "base64" }';
    const hasTypedBase64Response = generatedReturn !== "void" &&
      signaturePrefix.includes(base64Query);
    const returnType = generatedReturn === "void"
      ? "ArrayBuffer"
      : `ArrayBuffer | ${generatedReturn}`;
    method = method
      .slice(0, returnStart) +
      `): Promise<${returnType}` +
      method.slice(returnEnd);
    if (hasTypedBase64Response) {
      const jsonSignature = signaturePrefix.replace(
        base64Query,
        'query: { "encoding": "base64" }',
      );
      const binarySignature = signaturePrefix.replace(
        base64Query,
        'query?: { "encoding"?: undefined }',
      );
      method =
        `${jsonSignature}): Promise<${generatedReturn}>;\n` +
        `${binarySignature}): Promise<ArrayBuffer>;\n` +
        method;
    }
    method = method
      .replace(
        "        init,\n      });",
        '        init,\n        responseType: "arrayBuffer",\n      });',
      );
    if (!method.includes(`Promise<${returnType}>`) || !method.includes('responseType: "arrayBuffer"')) {
      throw new Error(`Generated SDK binary operation ${operation.operationId} did not transform safely.`);
    }
    transformed = transformed.slice(0, start) + method + transformed.slice(end + "\n    }".length);
  }

  return transformed;
}

function withTextResponses(
  code: string,
  textNames: Set<string>,
  operations: Array<{ operationId: string; functionName: string }>,
): string {
  let transformed = code;
  for (const operation of operations) {
    if (!textNames.has(operation.operationId)) continue;
    const marker = `    async ${operation.functionName}(`;
    const start = transformed.indexOf(marker);
    if (start < 0) throw new Error(`Generated SDK is missing text operation ${operation.operationId}.`);
    const signatureEnd = transformed.indexOf("\n", start);
    const returnStart = transformed.lastIndexOf("): Promise<", signatureEnd);
    const returnEnd = transformed.lastIndexOf("> {", signatureEnd);
    if (returnStart < start || returnEnd < returnStart) {
      throw new Error(`Generated SDK text operation ${operation.operationId} has no safe return boundary.`);
    }
    const generatedReturn = transformed.slice(returnStart + "): Promise<".length, returnEnd);
    if (generatedReturn.split(" | ").includes("string")) continue;
    transformed = transformed.slice(0, returnStart) +
      `): Promise<${generatedReturn} | string` +
      transformed.slice(returnEnd);
  }
  return transformed;
}

const header =
  "// @generated from src/server/openapi.ts by scripts/generate-sdk.ts — DO NOT EDIT.\n" +
  "// Regenerate: bun run sdk:generate\n\n";

// The hand-maintained tail of the generated file. Two rules keep the `./sdk`
// bundle hosted-only and self-contained (hasna/apps#1720 validation):
//   - IdentityError comes from the dependency-free `identity-error.ts`, never
//     from `identity.ts` (which imports db.ts and with it `bun:sqlite`);
//   - the resolver seam is `./resolve.ts`, the SDK's adapter onto the ONE
//     @hasna/contracts client chain, so a consumer never writes a private copy.
const identityExport = 'export { IdentityError } from "../lib/identity-error.js";';
const resolverExport =
  'export { ConversationsSdkResolutionError, createConversationsClient, resolveConversationsSdkTransport } from "./resolve.js";\n' +
  'export type { ConversationsSdkTransport, ResolveConversationsSdkTransportOptions } from "./resolve.js";';

export function generateSdkSource(spec: typeof openapiSpec = openapiSpec): {
  code: string;
  operations: number;
  warnings: string[];
} {
  const result = generateSdkFromOpenApi(spec as any, {
    className: "ConversationsClient",
    apiKeyHeader: "x-api-key",
  });
  const generated = withTextResponses(
    withBinaryResponses(
      withActionableErrors(result.code),
      binaryOperationNames(spec),
      result.operations,
    ),
    textOperationNames(spec),
    result.operations,
  ).trimEnd();
  return {
    code: `${header}${generated}\n\n${identityExport}\n${resolverExport}\n`,
    operations: result.operations.length,
    warnings: [...result.warnings],
  };
}

export function writeGeneratedSdk(options: {
  spec?: typeof openapiSpec;
  outputPath?: string;
} = {}): {
  code: string;
  operations: number;
  warnings: string[];
  outputPath: string;
} {
  const outputPath = options.outputPath ?? defaultOutputPath;
  const generated = generateSdkSource(options.spec);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, generated.code);
  return { ...generated, outputPath };
}

if (import.meta.main) {
  const result = writeGeneratedSdk();
  console.log(`ok generated SDK -> src/sdk/index.ts (${result.operations} operations)`);
  if (result.warnings.length) {
    console.log("warnings:\n  " + result.warnings.join("\n  "));
  }
}
