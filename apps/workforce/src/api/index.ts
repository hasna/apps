import { OP_REGISTRY, type OpDef } from "../services/registry.js";
import { scopeForAction } from "../server/auth.js";
import { APP_VERSION } from "../version.js";

// OpenAPI 3.1 document built from the single op registry, so the REST contract
// can never drift from the CLI/MCP surfaces (interface parity).

export interface OpenApiOperation {
  operationId: string;
  summary: string;
  tags: string[];
  security: Array<Record<string, string[]>>;
  responses: Record<string, { description: string }>;
}

export type OpenApiPathItem = Partial<Record<"get" | "post" | "patch" | "delete", OpenApiOperation>>;

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string }>;
  components: { securitySchemes: Record<string, { type: string; scheme: string }> };
  paths: Record<string, OpenApiPathItem>;
}

function camel(op: string): string {
  return op.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_]+)/g, "{$1}");
}

function tagFor(op: OpDef): string {
  return op.op.includes("assignment")
    ? "assignments"
    : op.op.includes("capabilit")
      ? "capabilities"
      : op.op.includes("lifecycle") || op.op.includes("role_change") || op.op.endsWith("_member")
        ? "lifecycle"
        : op.op.includes("export")
          ? "exports"
          : "members";
}

export function buildOpenApiDocument(): OpenApiDocument {
  const paths: Record<string, OpenApiPathItem> = {
    "/health": {
      get: {
        operationId: "getHealth",
        summary: "Health check",
        tags: ["system"],
        security: [],
        responses: { "200": { description: "Service health { status, version, mode }" } },
      },
    },
  };

  for (const op of OP_REGISTRY) {
    const path = toOpenApiPath(op.surfaces.api.path);
    const method = op.surfaces.api.method.toLowerCase() as keyof OpenApiPathItem;
    const item = (paths[path] ??= {});
    item[method] = {
      operationId: camel(op.op),
      summary: op.summary,
      tags: [tagFor(op)],
      security: [{ bearerAuth: [scopeForAction(op.action)] }],
      responses: {
        "200": { description: "Success" },
        "401": { description: "Unauthorized" },
        "403": { description: "Permission denied" },
        "404": { description: "Not found" },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "@hasna/workforce",
      version: APP_VERSION,
      description: "Unified roster/HRIS: humans, contractors and agents as first-class org members.",
    },
    servers: [{ url: "/v1" }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    paths,
  };
}

/** The generated OpenAPI document (object form). */
export const openApiDocument: OpenApiDocument = buildOpenApiDocument();

export function openApiDocumentJson(): string {
  return JSON.stringify(openApiDocument, null, 2);
}
