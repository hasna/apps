import { readFileSync } from "node:fs";
import { OPS } from "../services/registry.js";
import type { OpDef } from "../services/op-types.js";
import { APP_VERSION } from "../version.js";

// OpenAPI 3.1 document generated from the op registry — the /v1 surface has one
// operation per registry op, so the doc stays in lockstep with CLI + MCP.

function toOpenApiPath(template: string): string {
  return template.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function pathParams(template: string): string[] {
  return [...template.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1] as string);
}

function operationFor(op: OpDef): Record<string, unknown> {
  const parameters: Array<Record<string, unknown>> = [];
  for (const name of pathParams(op.http.pathTemplate)) {
    parameters.push({ name, in: "path", required: true, schema: { type: "string" } });
  }
  for (const name of op.http.queryKeys ?? []) {
    parameters.push({ name, in: "query", required: false, schema: { type: "string" } });
  }
  const operation: Record<string, unknown> = {
    operationId: op.op,
    summary: op.summary,
    tags: [op.op.split(".")[0]],
    security: [{ bearerAuth: [op.scope] }],
    responses: { "200": { description: "OK" } },
  };
  if (parameters.length > 0) operation.parameters = parameters;
  if ((op.http.bodyKeys ?? []).length > 0) {
    const properties: Record<string, unknown> = {};
    for (const key of op.http.bodyKeys ?? []) properties[key] = {};
    operation.requestBody = {
      required: true,
      content: { "application/json": { schema: { type: "object", properties } } },
    };
  }
  return operation;
}

const SYSTEM_ENDPOINTS: Array<[string, string, Record<string, unknown>]> = [
  ["/health", "get", { operationId: "system.health", summary: "Liveness + version + mode.", security: [], responses: { "200": { description: "OK" } } }],
  ["/ready", "get", { operationId: "system.ready", summary: "Readiness probe.", security: [], responses: { "200": { description: "Ready" }, "503": { description: "Not ready" } } }],
  ["/version", "get", { operationId: "system.version", summary: "Version + mode.", security: [], responses: { "200": { description: "OK" } } }],
];

export function openApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [path, method, operation] of SYSTEM_ENDPOINTS) {
    paths[path] = { ...(paths[path] ?? {}), [method]: operation };
  }
  for (const op of OPS) {
    const path = toOpenApiPath(op.http.pathTemplate);
    const method = op.http.method.toLowerCase();
    paths[path] = { ...(paths[path] ?? {}), [method]: operationFor(op) };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "@hasna/consolidations",
      version: APP_VERSION,
      description: "Group financial consolidation: GL import, COA normalization, FX translation, intercompany eliminations, consolidated P&L/BS/CF.",
    },
    servers: [{ url: "http://127.0.0.1:3488" }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
    security: [{ bearerAuth: [] }],
    paths,
  };
}

export function serializeOpenApiDocument(): string {
  // Minified single line — keeps the committed artifact under the file-size cap.
  return JSON.stringify(openApiDocument());
}

export interface OpenApiSummary {
  operation_count: number;
  operation_ids: string[];
}

export function summarizeOpenApiDocument(doc: Record<string, unknown> = openApiDocument()): OpenApiSummary {
  const ids: string[] = [];
  const paths = doc.paths as Record<string, Record<string, { operationId?: string }>>;
  for (const methods of Object.values(paths)) {
    for (const operation of Object.values(methods)) {
      if (operation.operationId) ids.push(operation.operationId);
    }
  }
  return { operation_count: ids.length, operation_ids: ids };
}

export interface OpenApiCheck {
  valid: boolean;
  path: string;
  operation_count: number;
  drift?: boolean;
}

export function checkOpenApiDocument(path = "openapi.json"): OpenApiCheck {
  const generated = serializeOpenApiDocument();
  let current = "";
  try {
    current = readFileSync(path, "utf8");
  } catch {
    return { valid: false, path, operation_count: summarizeOpenApiDocument().operation_count, drift: true };
  }
  const valid = current.trim() === generated.trim();
  return { valid, path, operation_count: summarizeOpenApiDocument().operation_count, drift: !valid };
}
