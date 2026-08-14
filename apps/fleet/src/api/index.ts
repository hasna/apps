import { readFileSync } from "node:fs";
import { APP_VERSION } from "../version.js";
import { REGISTRY, type OpDescriptor } from "../services/registry.js";

// OpenAPI 3.1 document GENERATED from the shared op registry. Kept in sync with
// the committed openapi.json and verified by test/openapi-contract.test.ts.

interface OpenApiParameter {
  name: string;
  in: "path" | "query";
  required: boolean;
  schema: { type: string };
}

function pathParams(pattern: string): string[] {
  return pattern
    .split("/")
    .filter((s) => s.startsWith(":"))
    .map((s) => s.slice(1));
}

function toOpenApiPath(pattern: string): string {
  return pattern
    .split("/")
    .map((s) => (s.startsWith(":") ? `{${s.slice(1)}}` : s))
    .join("/");
}

function buildOperation(op: OpDescriptor): Record<string, unknown> {
  const params = pathParams(op.path);
  const shapeKeys = Object.keys(op.inputShape);
  const parameters: OpenApiParameter[] = [];

  for (const p of params) {
    parameters.push({ name: p, in: "path", required: true, schema: { type: "string" } });
  }
  if (op.method === "GET") {
    for (const key of shapeKeys) {
      if (params.includes(key)) continue;
      parameters.push({ name: key, in: "query", required: false, schema: { type: "string" } });
    }
  }

  const operation: Record<string, unknown> = {
    operationId: op.op,
    summary: op.summary,
    tags: [op.kind],
    security: [{ bearerAuth: op.scopes }],
    responses: {
      "200": { description: "Success" },
      "400": { description: "Validation error" },
      "401": { description: "Unauthorized" },
      "403": { description: "Forbidden (scope/entity)" },
      "404": { description: "Not found" },
    },
  };
  if (parameters.length > 0) operation.parameters = parameters;

  if (op.method === "POST" || op.method === "PATCH") {
    const properties: Record<string, { type: string }> = {};
    for (const key of shapeKeys) {
      if (params.includes(key)) continue;
      properties[key] = { type: "string" };
    }
    operation.requestBody = {
      required: op.method === "POST",
      content: { "application/json": { schema: { type: "object", properties } } },
    };
  }

  return operation;
}

export function openApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  // System endpoints.
  paths["/health"] = { get: { operationId: "health", summary: "Health check", security: [], responses: { "200": { description: "Health payload { status, version, mode }" } } } };
  paths["/ready"] = { get: { operationId: "ready", summary: "Readiness check", security: [], responses: { "200": { description: "Ready" }, "503": { description: "Not ready" } } } };
  paths["/version"] = { get: { operationId: "version", summary: "Version", security: [], responses: { "200": { description: "Version payload" } } } };

  for (const op of REGISTRY) {
    const key = toOpenApiPath(op.path);
    paths[key] = paths[key] ?? {};
    paths[key]![op.method.toLowerCase()] = buildOperation(op);
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "@hasna/fleet API",
      version: APP_VERSION,
      description: "Read-only AgentOps control tower. Config resources are full-CRUD; fused observability resources are GET-only.",
    },
    servers: [{ url: "http://127.0.0.1:3485" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Bearer credential mapped to scopes + entity/org set." },
      },
    },
    security: [{ bearerAuth: [] }],
    paths,
  };
}

export function serializeOpenApiDocument(): string {
  return JSON.stringify(openApiDocument());
}

export interface OpenApiSummary {
  operation_count: number;
  operation_ids: string[];
}

export function summarizeOpenApiDocument(serialized: string): OpenApiSummary {
  const doc = JSON.parse(serialized) as { paths: Record<string, Record<string, { operationId?: string }>> };
  const ids: string[] = [];
  for (const methods of Object.values(doc.paths)) {
    for (const method of Object.keys(methods)) {
      const op = methods[method];
      if (op?.operationId) ids.push(op.operationId);
    }
  }
  return { operation_count: ids.length, operation_ids: ids };
}

export interface OpenApiCheckResult {
  valid: boolean;
  path: string;
  operation_count: number;
  error?: string;
}

export function checkOpenApiDocument(path: string): OpenApiCheckResult {
  try {
    const committed = readFileSync(path, "utf8").trim();
    const generated = serializeOpenApiDocument();
    if (committed !== generated) {
      return { valid: false, path, operation_count: 0, error: "openapi.json is stale; run openapi:generate" };
    }
    return { valid: true, path, operation_count: summarizeOpenApiDocument(generated).operation_count };
  } catch (error) {
    return { valid: false, path, operation_count: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
