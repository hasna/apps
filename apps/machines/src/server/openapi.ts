// OpenAPI 3.1 description of the machines control-plane serve API.
//
// This is the single source of truth for the versioned /v1 surface. The running
// server serves it at GET /openapi.json, and the typed SDK in src/sdk is
// generated from it via `@hasna/contracts/sdk` (bun run sdk:generate).

import { getPackageVersion } from "../version.js";

export function buildOpenApiDocument(version: string = getPackageVersion()): Record<string, unknown> {
  const machineSchema = {
    type: "object",
    required: ["id", "status", "labels", "metadata", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string", description: "Machine id (hostname or explicit id)." },
      friendlyName: { type: "string", nullable: true },
      platform: { type: "string", nullable: true },
      arch: { type: "string", nullable: true },
      status: { type: "string", description: "Lifecycle status, e.g. online/offline/unknown." },
      labels: { type: "object", additionalProperties: true },
      metadata: { type: "object", additionalProperties: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  };

  const heartbeatSchema = {
    type: "object",
    required: ["machineId", "pid", "status", "updatedAt"],
    properties: {
      machineId: { type: "string" },
      pid: { type: "integer" },
      status: { type: "string" },
      updatedAt: { type: "string", format: "date-time" },
      daemonVersion: { type: "string", nullable: true },
      agentMode: { type: "string", nullable: true },
      platform: { type: "string", nullable: true },
      arch: { type: "string", nullable: true },
      uptimeSeconds: { type: "integer", nullable: true },
      observedAt: { type: "string", format: "date-time", nullable: true },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Machines Control Plane API",
      version,
      description:
        "Fleet machine registry control-plane API. Every /v1 route requires an API key " +
        "(x-api-key or Authorization: Bearer) issued by @hasna/contracts. Reads/writes hit " +
        "the shared RDS machines database directly (Amendment A1, PURE REMOTE).",
    },
    servers: [{ url: "/", description: "This server" }],
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      schemas: {
        Machine: machineSchema,
        Heartbeat: heartbeatSchema,
        RegisterMachineRequest: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
            friendlyName: { type: "string", nullable: true },
            platform: { type: "string", nullable: true },
            arch: { type: "string", nullable: true },
            status: { type: "string" },
            labels: { type: "object", additionalProperties: true },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        UpdateMachineRequest: {
          type: "object",
          properties: {
            friendlyName: { type: "string", nullable: true },
            platform: { type: "string", nullable: true },
            arch: { type: "string", nullable: true },
            status: { type: "string" },
            labels: { type: "object", additionalProperties: true },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        MachineList: {
          type: "object",
          required: ["machines", "count"],
          properties: {
            machines: { type: "array", items: { $ref: "#/components/schemas/Machine" } },
            count: { type: "integer" },
          },
        },
        HeartbeatList: {
          type: "object",
          required: ["heartbeats", "count"],
          properties: {
            heartbeats: { type: "array", items: { $ref: "#/components/schemas/Heartbeat" } },
            count: { type: "integer" },
          },
        },
        DeleteResult: {
          type: "object",
          required: ["deleted", "id"],
          properties: { deleted: { type: "boolean" }, id: { type: "string" } },
        },
        HealthResponse: {
          type: "object",
          required: ["status", "version", "mode"],
          properties: {
            status: { type: "string" },
            version: { type: "string" },
            mode: { type: "string" },
          },
        },
        ReadyResponse: {
          type: "object",
          required: ["status", "version", "mode"],
          properties: {
            status: { type: "string" },
            version: { type: "string" },
            mode: { type: "string" },
            pendingMigrations: { type: "array", items: { type: "string" } },
            latencyMs: { type: "integer" },
          },
        },
        ErrorResponse: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "string" }, reason: { type: "string" } },
        },
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      "/health": {
        get: {
          operationId: "health",
          summary: "Liveness probe (no auth).",
          security: [],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/HealthResponse" } } } },
          },
        },
      },
      "/ready": {
        get: {
          operationId: "ready",
          summary: "Readiness probe: reachable RDS and schema migrated (no auth).",
          security: [],
          responses: {
            "200": { description: "Ready", content: { "application/json": { schema: { $ref: "#/components/schemas/ReadyResponse" } } } },
            "503": { description: "Not ready", content: { "application/json": { schema: { $ref: "#/components/schemas/ReadyResponse" } } } },
          },
        },
      },
      "/version": {
        get: {
          operationId: "version",
          summary: "Service version and mode (no auth).",
          security: [],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/HealthResponse" } } } },
          },
        },
      },
      "/v1/machines": {
        get: {
          operationId: "listMachines",
          summary: "List registered machines.",
          parameters: [
            { name: "status", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer" } },
            { name: "offset", in: "query", required: false, schema: { type: "integer" } },
          ],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/MachineList" } } } },
          },
        },
        post: {
          operationId: "registerMachine",
          summary: "Register (upsert) a machine.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/RegisterMachineRequest" } } },
          },
          responses: {
            "200": { description: "Registered", content: { "application/json": { schema: { $ref: "#/components/schemas/Machine" } } } },
            "400": { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/machines/{id}": {
        get: {
          operationId: "getMachine",
          summary: "Fetch one machine by id.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Machine" } } } },
            "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
        patch: {
          operationId: "updateMachine",
          summary: "Partially update a machine.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateMachineRequest" } } },
          },
          responses: {
            "200": { description: "Updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Machine" } } } },
            "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
        delete: {
          operationId: "deleteMachine",
          summary: "Deregister a machine.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Deleted", content: { "application/json": { schema: { $ref: "#/components/schemas/DeleteResult" } } } },
          },
        },
      },
      "/v1/heartbeats": {
        get: {
          operationId: "listHeartbeats",
          summary: "List agent heartbeats across the fleet.",
          parameters: [
            { name: "machineId", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer" } },
          ],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/HeartbeatList" } } } },
          },
        },
      },
    },
  };
}
