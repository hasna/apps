import { APP_VERSION } from "../version.js";
import { OP_REGISTRY, type OpDef } from "../services/registry.js";

// OpenAPI document builder generated from the op registry, so the REST surface
// and the parity table share one source of truth.

export interface OpenApiOperation {
  operationId: string;
  summary: string;
  tags: string[];
  responses: Record<string, { description: string }>;
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
}

/** Convert an op id like "asset.create" to an operationId like "createAsset". */
export function operationIdFor(op: string): string {
  const [resource, action] = op.split(".");
  const r = resource ?? op;
  const a = action ?? "";
  const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
  // action-first reads naturally: create/get/list/update/delete + Resource
  return `${a}${cap(r)}`;
}

/** OpenAPI path template `/v1/assets/:id` -> `/v1/assets/{id}`. */
function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_]+)/g, "{$1}");
}

const SYSTEM_PATHS: Record<string, Record<string, OpenApiOperation>> = {
  "/health": {
    get: { operationId: "getHealth", summary: "Liveness + version + mode", tags: ["system"], responses: { "200": { description: "ok" } } },
  },
  "/ready": {
    get: { operationId: "getReady", summary: "Readiness (DB + migrations)", tags: ["system"], responses: { "200": { description: "ready" }, "503": { description: "not ready" } } },
  },
  "/version": {
    get: { operationId: "getVersion", summary: "Version + mode", tags: ["system"], responses: { "200": { description: "ok" } } },
  },
};

export function buildOpenApiDocument(): OpenApiDocument {
  const paths: Record<string, Record<string, OpenApiOperation>> = { ...SYSTEM_PATHS };
  for (const def of OP_REGISTRY) {
    const path = toOpenApiPath(def.api.path);
    const method = def.api.method.toLowerCase();
    paths[path] ??= {};
    paths[path][method] = {
      operationId: operationIdFor(def.op),
      summary: describeOp(def),
      tags: [def.resource],
      responses: def.mutates
        ? { "200": { description: "success" }, "400": { description: "validation error" }, "401": { description: "unauthorized" }, "403": { description: "forbidden" }, "404": { description: "not found" } }
        : { "200": { description: "success" }, "401": { description: "unauthorized" }, "403": { description: "forbidden" }, "404": { description: "not found" } },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Hasna IP Portfolio API",
      version: APP_VERSION,
      description: "Trademarks, patents, copyrights, brand assets — registrations, renewals, Nice classes, filing docs. Entity-anchored.",
    },
    paths,
  };
}

function describeOp(def: OpDef): string {
  const verb = def.op.split(".")[1] ?? "";
  return `${verb} ${def.resource}`;
}

/** Frozen document instance for interface-parity + openapi-contract assertions. */
export const openApiDocument: OpenApiDocument = buildOpenApiDocument();

export function openApiDocumentJson(): string {
  return JSON.stringify(openApiDocument, null, 2);
}
