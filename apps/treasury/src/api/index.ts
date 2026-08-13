import { APP_VERSION } from "../version.js";
import { OPS, type OpDef, type OpField } from "../services/registry.js";

// OpenAPI document generated from the shared op registry so /v1, CLI, MCP, and
// the spec stay in lockstep (interface parity). Verified by openapi-contract.test.

interface OpenApiParameter {
  name: string;
  in: "path" | "query";
  required: boolean;
  schema: { type: string };
}

interface OpenApiOperation {
  operationId: string;
  summary: string;
  parameters?: OpenApiParameter[];
  requestBody?: unknown;
  responses: Record<string, { description: string }>;
}

function jsonType(f: OpField): string {
  if (f.type === "int") return "integer";
  if (f.type === "number") return "number";
  if (f.type === "bool") return "boolean";
  return "string";
}

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_]+)/g, "{$1}");
}

function operationFor(op: OpDef): OpenApiOperation {
  const params: OpenApiParameter[] = op.fields
    .filter((f) => f.location === "path" || f.location === "query")
    .map((f) => ({ name: f.name, in: f.location as "path" | "query", required: Boolean(f.required), schema: { type: jsonType(f) } }));
  const bodyFields = op.fields.filter((f) => f.location === "body");
  const operation: OpenApiOperation = {
    operationId: op.operationId,
    summary: op.description,
    responses: { "200": { description: "OK" }, "4XX": { description: "Error envelope { code, message, suggestion }" } },
  };
  if (params.length > 0) operation.parameters = params;
  if (bodyFields.length > 0) {
    operation.requestBody = {
      required: bodyFields.some((f) => f.required),
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: bodyFields.filter((f) => f.required).map((f) => f.name),
            properties: Object.fromEntries(bodyFields.map((f) => [f.name, { type: jsonType(f) }])),
          },
        },
      },
    };
  }
  return operation;
}

export function openApiDocument(): {
  openapi: string;
  info: { title: string; version: string; description: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
} {
  const paths: Record<string, Record<string, OpenApiOperation>> = {
    "/health": { get: { operationId: "getHealth", summary: "Liveness", responses: { "200": { description: "OK" } } } },
    "/ready": { get: { operationId: "getReady", summary: "Readiness", responses: { "200": { description: "OK" } } } },
    "/version": { get: { operationId: "getVersion", summary: "Version", responses: { "200": { description: "OK" } } } },
  };
  for (const op of OPS) {
    const p = toOpenApiPath(op.http.path);
    paths[p] = paths[p] ?? {};
    paths[p]![op.http.method.toLowerCase()] = operationFor(op);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "@hasna/treasury API",
      version: APP_VERSION,
      description: "Multi-entity cash/treasury cockpit — consolidated balances, FX exposure, runway, forecast, and advisory sweep recommendations.",
    },
    paths,
  };
}

export const openApiDoc = openApiDocument();
