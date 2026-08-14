/**
 * OpenAPI 3.1 document for mementos-serve, generated from the live route table.
 *
 * Served at `/v1/openapi.json` (and `/openapi.json`). This is the canonical
 * serve contract the SDK targets; because it is derived from the same
 * `routes[]` the router matches, it can never drift from what the server
 * actually exposes.
 */
import { routes } from "./router.js";

/** `/api/memories/:id` -> `/v1/memories/{id}` */
function toV1Path(path: string): string {
  return path.replace(/^\/api/, "/v1").replace(/:(\w+)/g, "{$1}");
}

export function buildOpenApiDocument(version: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  // Operational probes (registered inline in index.ts, not the route table).
  for (const p of ["/health", "/ready", "/version"]) {
    paths[p] = {
      get: {
        summary: `Service ${p.slice(1)} probe`,
        security: [],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    version: { type: "string" },
                    mode: { type: "string", enum: ["local", "cloud"] },
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  for (const route of routes) {
    const p = toV1Path(route.path);
    const method = route.method.toLowerCase();
    const params: Record<string, unknown>[] = route.paramNames.map((name) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    if (route.method === "GET" && route.path === "/api/projects/:id/resources") {
      params.push(
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 1000, default: 100 },
        },
        {
          name: "cursor",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "resource_kinds",
          in: "query",
          required: false,
          description: "Comma-separated subset of project, knowledge, memory, session",
          schema: { type: "string" },
        },
      );
    }
    const successSchema = route.method === "GET"
      && route.path === "/api/projects/:id/resources"
      ? { $ref: "#/components/schemas/MementosProjectResourcePage" }
      : route.method === "GET"
        && route.path === "/api/projects/:id/resources/:kind/:resource_id"
        ? { $ref: "#/components/schemas/MementosProjectResourceExactResult" }
        : undefined;
    paths[p] = paths[p] ?? {};
    (paths[p] as Record<string, unknown>)[method] = {
      summary: `${route.method} ${p}`,
      operationId: `${method}_${p.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      ...(params.length ? { parameters: params } : {}),
      responses: {
        "200": {
          description: "OK",
          ...(successSchema
            ? { content: { "application/json": { schema: successSchema } } }
            : {}),
        },
        "401": { description: "Unauthorized" },
        "403": { description: "Forbidden" },
        "404": { description: "Not found" },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "@hasna/mementos serve API",
      version,
      description: "Universal memory system for AI agents — REST API (self_hosted).",
    },
    servers: [{ url: "/v1" }, { url: "/api" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
        apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      schemas: {
        MementosProjectResource: {
          type: "object",
          additionalProperties: false,
          required: [
            "authority",
            "source_package",
            "project_id",
            "resource_kind",
            "stable_id",
            "revision",
            "digest",
            "membership",
          ],
          properties: {
            authority: { const: "mementos" },
            source_package: { const: "@hasna/mementos" },
            project_id: { type: "string" },
            resource_kind: {
              type: "string",
              enum: ["project", "knowledge", "memory", "session"],
            },
            stable_id: { type: "string" },
            revision: { type: "string" },
            digest: { type: "string", pattern: "^[0-9a-f]{64}$" },
            membership: {
              type: "string",
              enum: ["project_aggregate", "explicit_project_id_or_focus"],
            },
          },
        },
        MementosProjectResourceAuthority: {
          type: "object",
          additionalProperties: false,
          required: [
            "authority",
            "authority_id",
            "tenant_id",
            "corpus_id",
            "package_version",
          ],
          properties: {
            authority: { const: "mementos" },
            authority_id: { type: "string" },
            tenant_id: { type: "string" },
            corpus_id: { type: "string" },
            package_version: { type: "string" },
          },
        },
        MementosProjectResourcePage: {
          type: "object",
          additionalProperties: false,
          required: [
            "schema",
            "authority",
            "project_id",
            "project_revision",
            "collection_revision",
            "resource_kinds",
            "resources",
            "count",
            "total",
            "limit",
            "cursor",
            "next_cursor",
            "has_more",
            "complete",
            "truncated",
          ],
          properties: {
            schema: { const: "mementos.project-resources.v1" },
            authority: { $ref: "#/components/schemas/MementosProjectResourceAuthority" },
            project_id: { type: "string" },
            project_revision: { type: "string" },
            collection_revision: { type: "string", pattern: "^[0-9a-f]{64}$" },
            resource_kinds: {
              type: "array",
              items: { type: "string", enum: ["project", "knowledge", "memory", "session"] },
            },
            resources: {
              type: "array",
              items: { $ref: "#/components/schemas/MementosProjectResource" },
            },
            count: { type: "integer", minimum: 0 },
            total: { type: "integer", minimum: 0 },
            limit: { type: "integer", minimum: 1, maximum: 1000 },
            cursor: { type: ["string", "null"] },
            next_cursor: { type: ["string", "null"] },
            has_more: { type: "boolean" },
            complete: { const: true },
            truncated: { const: false },
          },
        },
        MementosProjectResourceExactResult: {
          type: "object",
          additionalProperties: false,
          required: [
            "schema",
            "authority",
            "project_id",
            "project_revision",
            "collection_revision",
            "resource",
            "complete",
            "truncated",
          ],
          properties: {
            schema: { const: "mementos.project-resource.v1" },
            authority: { $ref: "#/components/schemas/MementosProjectResourceAuthority" },
            project_id: { type: "string" },
            project_revision: { type: "string" },
            collection_revision: { type: "string", pattern: "^[0-9a-f]{64}$" },
            resource: { $ref: "#/components/schemas/MementosProjectResource" },
            complete: { const: true },
            truncated: { const: false },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
    paths,
  };
}
