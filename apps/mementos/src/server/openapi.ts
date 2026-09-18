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

function auditPageSchema(contract: string): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "contract", "entries", "count", "total", "limit", "cursor", "next_cursor",
      "consumed", "has_more", "complete", "snapshot_at", "filters", "sort",
    ],
    properties: {
      contract: { const: contract },
      entries: { type: "array", items: { $ref: "#/components/schemas/MementosAuditEntry" } },
      count: { type: "integer", minimum: 0 },
      total: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 1000 },
      cursor: { type: ["string", "null"] },
      next_cursor: { type: ["string", "null"] },
      consumed: { type: "integer", minimum: 0 },
      has_more: { type: "boolean" },
      complete: { type: "boolean" },
      snapshot_at: { type: "string", format: "date-time" },
      filters: { $ref: "#/components/schemas/MementosAuditFilters" },
      sort: {
        type: "object",
        additionalProperties: false,
        required: ["field", "direction", "tie_breaker"],
        properties: {
          field: { const: "created_at" },
          direction: { const: "desc" },
          tie_breaker: { const: "id" },
        },
      },
    },
  };
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
                    backend: { type: "string", enum: ["sqlite", "postgresql"] },
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
    if (route.method === "GET" && route.path === "/api/memories/:id/audit-trail") {
      params.push(
        { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000, default: 50 } },
        { name: "cursor", in: "query", required: false, schema: { type: "string", maxLength: 4096 } },
      );
    }
    if (route.method === "GET" && route.path === "/api/audit/export") {
      params.push(
        { name: "since", in: "query", required: false, schema: { type: "string", format: "date-time" } },
        { name: "until", in: "query", required: false, schema: { type: "string", format: "date-time" } },
        { name: "operation", in: "query", required: false, schema: { type: "string", enum: ["create", "update", "delete", "archive", "restore", "read"] } },
        { name: "agent_id", in: "query", required: false, schema: { type: "string", minLength: 1, maxLength: 512 } },
        { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000, default: 50 } },
        { name: "cursor", in: "query", required: false, schema: { type: "string", maxLength: 4096 } },
      );
    }
    const successSchema = route.method === "GET" && route.path === "/api/memories/:id/audit-trail"
      ? { $ref: "#/components/schemas/MementosAuditTrailPage" }
      : route.method === "GET" && route.path === "/api/audit/export"
        ? { $ref: "#/components/schemas/MementosAuditExportPage" }
        : route.method === "GET" && route.path === "/api/audit/stats"
          ? { $ref: "#/components/schemas/MementosAuditStats" }
          : route.method === "GET"
      && route.path === "/api/projects/:id/resources"
      ? { $ref: "#/components/schemas/MementosProjectResourcePage" }
      : route.method === "GET"
        && route.path === "/api/projects/:id/resources/:kind/:resource_id"
        ? { $ref: "#/components/schemas/MementosProjectResourceExactResult" }
        : route.path === "/api/machines" && route.method === "GET"
          ? { $ref: "#/components/schemas/MementosMachineList" }
          : route.path === "/api/machines" && route.method === "POST"
            ? { $ref: "#/components/schemas/MementosMachineRegistration" }
            : route.path.startsWith("/api/machines/") && route.method === "DELETE"
              ? { $ref: "#/components/schemas/MementosMachineDeleteReceipt" }
              : route.path === "/api/machines/:id/touch"
                ? { $ref: "#/components/schemas/MementosMachineTouchReceipt" }
                : route.path.startsWith("/api/machines/")
                  ? { $ref: "#/components/schemas/MementosMachineMutation" }
                : undefined;
    const requestBody = route.path === "/api/machines" && route.method === "POST"
      ? {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/MementosMachineRegistrationInput" } },
          },
        }
      : route.path === "/api/machines/:id" && route.method === "PATCH"
        ? {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MementosMachineRenameInput" },
              },
            },
          }
        : undefined;
    const successResponses: Record<string, unknown> = {
      "200": {
        description: "OK",
        ...(successSchema ? { content: { "application/json": { schema: successSchema } } } : {}),
      },
    };
    if (route.path === "/api/machines" && route.method === "POST") {
      successResponses["201"] = successResponses["200"];
    }
    const machineOperationIds: Record<string, string> = {
      "GET /api/machines": "listMachines",
      "POST /api/machines": "registerMachine",
      "GET /api/machines/:id": "getMachine",
      "PATCH /api/machines/:id": "renameMachine",
      "POST /api/machines/:id/primary": "setPrimaryMachine",
      "POST /api/machines/:id/touch": "touchMachine",
      "DELETE /api/machines/:id": "deleteMachine",
      "GET /api/memories/:id/audit-trail": "getMemoryAuditTrail",
      "GET /api/audit/export": "exportAuditLog",
      "GET /api/audit/stats": "getAuditStats",
    };
    const operationKey = `${route.method} ${route.path}`;
    paths[p] = paths[p] ?? {};
    (paths[p] as Record<string, unknown>)[method] = {
      summary: `${route.method} ${p}`,
      operationId: machineOperationIds[operationKey] ?? `${method}_${p.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      ...(params.length ? { parameters: params } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses: {
        ...successResponses,
        "400": { description: "Invalid request" },
        "401": { description: "Unauthorized" },
        "403": { description: "Forbidden" },
        "404": { description: "Not found" },
        "409": { description: "Conflict" },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "@hasna/mementos serve API",
      version,
      description: "Universal memory system for AI agents — REST API over the SQLite or PostgreSQL server backend.",
    },
    servers: [{ url: "/v1" }, { url: "/api" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
        apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      schemas: {
        MementosAuditEntry: {
          type: "object",
          additionalProperties: false,
          required: ["id", "memory_id", "memory_key", "operation", "agent_id", "old_value_hash", "new_value_hash", "changes", "created_at"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 512 },
            memory_id: { type: "string", minLength: 1, maxLength: 512 },
            memory_key: { type: ["string", "null"], maxLength: 4096 },
            operation: { type: "string", enum: ["create", "update", "delete", "archive", "restore", "read"] },
            agent_id: { type: ["string", "null"], maxLength: 512 },
            old_value_hash: { type: ["string", "null"], pattern: "^[0-9a-f]{32}$" },
            new_value_hash: { type: ["string", "null"], pattern: "^[0-9a-f]{32}$" },
            changes: { type: "object", additionalProperties: true },
            created_at: { type: "string", format: "date-time" },
          },
        },
        MementosAuditFilters: {
          type: "object",
          additionalProperties: false,
          required: ["memory_id", "since", "until", "operation", "agent_id"],
          properties: {
            memory_id: { type: ["string", "null"], maxLength: 512 },
            since: { type: ["string", "null"], format: "date-time" },
            until: { type: ["string", "null"], format: "date-time" },
            operation: { type: ["string", "null"], enum: ["create", "update", "delete", "archive", "restore", "read", null] },
            agent_id: { type: ["string", "null"], maxLength: 512 },
          },
        },
        MementosAuditTrailPage: auditPageSchema("mementos.audit.trail.v1"),
        MementosAuditExportPage: auditPageSchema("mementos.audit.export.v1"),
        MementosAuditStats: {
          type: "object",
          additionalProperties: false,
          required: ["contract", "total_entries", "by_operation", "recent_24h", "snapshot_at"],
          properties: {
            contract: { const: "mementos.audit.stats.v1" },
            total_entries: { type: "integer", minimum: 0 },
            by_operation: {
              type: "object",
              additionalProperties: false,
              required: ["create", "update", "delete", "archive", "restore", "read"],
              properties: Object.fromEntries(["create", "update", "delete", "archive", "restore", "read"].map((name) => [name, { type: "integer", minimum: 0 }])),
            },
            recent_24h: { type: "integer", minimum: 0 },
            snapshot_at: { type: "string", format: "date-time" },
          },
        },
        MementosMachine: {
          type: "object",
          additionalProperties: false,
          required: ["id", "name", "hostname", "platform", "is_primary", "created_at", "last_seen_at"],
          properties: {
            id: { type: "string", minLength: 1, description: "Stable server identity used by mutations and memory attribution" },
            name: { type: "string", minLength: 1, maxLength: 128 },
            hostname: { type: "string", minLength: 1, maxLength: 253, description: "Normalized account-local registration idempotency key; not an authorization boundary" },
            platform: { type: "string", minLength: 1, maxLength: 64 },
            is_primary: { type: "boolean" },
            created_at: { type: "string", format: "date-time" },
            last_seen_at: { type: "string", format: "date-time" },
          },
        },
        MementosMachineRegistrationInput: {
          type: "object",
          additionalProperties: false,
          required: ["hostname", "platform"],
          properties: {
            hostname: { type: "string", minLength: 1, maxLength: 253 },
            platform: { type: "string", minLength: 1, maxLength: 64 },
            name: { type: "string", minLength: 1, maxLength: 128 },
          },
        },
        MementosMachineRenameInput: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: { name: { type: "string", minLength: 1, maxLength: 128 } },
        },
        MementosMachineRegistration: {
          type: "object",
          additionalProperties: false,
          required: ["contract", "machine", "created", "identity"],
          properties: {
            contract: { const: "mementos.machine-registration.v1" },
            machine: { $ref: "#/components/schemas/MementosMachine" },
            created: { type: "boolean" },
            identity: {
              type: "object",
              additionalProperties: false,
              required: ["idempotency_key", "stable_id"],
              properties: {
                idempotency_key: { const: "normalized_hostname" },
                stable_id: { type: "string", minLength: 1 },
              },
            },
          },
        },
        MementosMachineList: {
          type: "object",
          additionalProperties: false,
          required: ["contract", "machines", "count", "complete"],
          properties: {
            contract: { const: "mementos.machines.v1" },
            machines: { type: "array", items: { $ref: "#/components/schemas/MementosMachine" } },
            count: { type: "integer", minimum: 0 },
            complete: { const: true },
          },
        },
        MementosMachineMutation: {
          type: "object",
          additionalProperties: false,
          required: ["contract", "machine"],
          properties: {
            contract: { const: "mementos.machine-mutation.v1" },
            machine: { $ref: "#/components/schemas/MementosMachine" },
          },
        },
        MementosMachineTouchReceipt: {
          type: "object",
          additionalProperties: false,
          required: ["contract", "touched", "id", "touched_at", "machine"],
          properties: {
            contract: { const: "mementos.machine-touch.v1" },
            touched: { const: true },
            id: { type: "string", minLength: 1 },
            touched_at: { type: "string", format: "date-time" },
            machine: { $ref: "#/components/schemas/MementosMachine" },
          },
        },
        MementosMachineDeleteReceipt: {
          type: "object",
          additionalProperties: false,
          required: ["contract", "deleted", "id"],
          properties: {
            contract: { const: "mementos.machine-mutation.v1" },
            deleted: { const: true },
            id: { type: "string", minLength: 1 },
          },
        },
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
