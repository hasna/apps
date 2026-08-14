#!/usr/bin/env bun
// Regenerate the typed HTTP SDK from the serve OpenAPI document.
//
//   bun run scripts/gen-sdk.ts
//
// Source of truth: openapi/loops.json (describes loops-serve). Output:
// src/sdk/http.ts — a dependency-free typed fetch client. Committed so
// consumers do not need the generator at install time.
import { generateSdkFromOpenApi, type OpenApiDocument } from "@hasna/contracts/sdk";

const spec = (await Bun.file(new URL("../openapi/loops.json", import.meta.url)).json()) as OpenApiDocument;
const generated = generateSdkFromOpenApi(spec, { className: "LoopsClient", apiKeyHeader: "x-api-key" });

const header = `// @generated from openapi/loops.json by scripts/gen-sdk.ts — DO NOT EDIT.
// Regenerate: bun run scripts/gen-sdk.ts
`;
await Bun.write(new URL("../src/sdk/http.ts", import.meta.url), header + generated.code);
console.log(
  JSON.stringify({ evt: "sdk_generated", operations: generated.operations.map((o) => o.functionName), warnings: generated.warnings }),
);
