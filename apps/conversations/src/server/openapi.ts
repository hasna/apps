/**
 * OpenAPI 3.1 description of the conversations-serve /v1 API.
 * Single source of truth for the generated SDK (scripts/generate-sdk.ts) and
 * the /v1/openapi.json discovery endpoint.
 */

import { version as pkgVersion } from "../../package.json";

const okObject = { type: "object", additionalProperties: true } as const;
const errorObject = {
  type: "object",
  additionalProperties: true,
  properties: {
    error: { type: "string" },
    code: { type: "string" },
    field: { type: "string" },
    value: { type: "string" },
    reason: { type: "string" },
    hint: { type: "string" },
  },
} as const;

export const openapiSpec = {
  openapi: "3.1.0",
  info: {
    title: "ConversationsClient",
    version: pkgVersion,
    description: "Self-hosted conversations API (pure-remote, API-key authenticated).",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
    },
    schemas: {
      Message: {
        type: "object",
        properties: {
          id: { type: "integer" },
          uuid: { type: "string" },
          session_id: { type: "string" },
          from_agent: { type: "string" },
          to_agent: { type: "string" },
          channel: { type: "string", nullable: true },
          project_id: { type: "string", nullable: true },
          content: { type: "string" },
          priority: { type: "string" },
          blocking: { type: "boolean" },
          created_at: { type: "string" },
        },
      },
      Channel: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string", nullable: true },
          topic: { type: "string", nullable: true },
          project_id: { type: "string", nullable: true },
          created_by: { type: "string" },
          created_at: { type: "string" },
          archived_at: { type: "string", nullable: true },
          metadata: { type: "object", nullable: true, additionalProperties: true },
          tags: { type: "array", items: { type: "string" } },
        },
      },
      Project: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string", nullable: true },
          path: { type: "string", nullable: true },
          repository: { type: "string", nullable: true },
          created_by: { type: "string" },
          status: { type: "string" },
          created_at: { type: "string" },
        },
      },
      Agent: {
        type: "object",
        properties: {
          agent: { type: "string" },
          session_id: { type: "string", nullable: true },
          role: { type: "string" },
          project_id: { type: "string" },
          status: { type: "string" },
          last_seen_at: { type: "string" },
        },
      },
    },
  },
  security: [{ apiKey: [] }],
  paths: {
    "/health": {
      get: {
        operationId: "getHealth",
        summary: "Liveness probe",
        security: [],
        responses: { "200": { description: "ok", content: { "application/json": { schema: okObject } } } },
      },
    },
    "/ready": {
      get: {
        operationId: "getReady",
        summary: "Readiness probe (pings Postgres)",
        security: [],
        responses: { "200": { description: "ready", content: { "application/json": { schema: okObject } } } },
      },
    },
    "/version": {
      get: {
        operationId: "getVersion",
        summary: "Version and mode",
        security: [],
        responses: { "200": { description: "version", content: { "application/json": { schema: okObject } } } },
      },
    },
    "/v1/messages": {
      get: {
        operationId: "listMessages",
        summary: "List messages",
        parameters: [
          { name: "to", in: "query", schema: { type: "string" } },
          { name: "from", in: "query", schema: { type: "string" } },
          { name: "channel", in: "query", schema: { type: "string" } },
          { name: "session", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "messages", content: { "application/json": { schema: okObject } } } },
      },
      post: {
        operationId: "sendMessage",
        summary: "Send a message",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            required: ["to", "content"],
            properties: {
              from: { type: "string" }, to: { type: "string" }, content: { type: "string" },
              channel: { type: "string" }, project_id: { type: "string" },
              session_id: { type: "string" }, priority: { type: "string" }, blocking: { type: "boolean" },
            },
          } } },
        },
        responses: { "201": { description: "created", content: { "application/json": { schema: okObject } } } },
      },
    },
    "/v1/messages/{id}": {
      get: {
        operationId: "getMessage",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "message", content: { "application/json": { schema: okObject } } } },
      },
      delete: {
        operationId: "deleteMessage",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
          { name: "from", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "deleted", content: { "application/json": { schema: okObject } } } },
      },
    },
    "/v1/channels": {
      get: {
        operationId: "listChannels",
        parameters: [{ name: "include_archived", in: "query", schema: { type: "boolean" } }],
        responses: { "200": { description: "channels", content: { "application/json": { schema: okObject } } } },
      },
      post: {
        operationId: "createChannel",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["name"],
            properties: {
              name: { type: "string" },
              created_by: { type: "string" },
              description: { type: "string" },
              topic: { type: "string" },
              project_id: { type: "string" },
              metadata: { type: "object", additionalProperties: true },
              tags: { type: "array", items: { type: "string" } },
            },
          } } },
        },
        responses: {
          "201": { description: "created", content: { "application/json": { schema: okObject } } },
          "400": {
            description: "validation error, including invalid project_id",
            content: { "application/json": { schema: errorObject } },
          },
        },
      },
    },
    "/v1/channels/{name}": {
      get: {
        operationId: "getChannel",
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "channel", content: { "application/json": { schema: okObject } } } },
      },
      patch: {
        operationId: "updateChannel",
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { content: { "application/json": { schema: okObject } } },
        responses: { "200": { description: "updated", content: { "application/json": { schema: okObject } } } },
      },
    },
    "/v1/projects": {
      get: {
        operationId: "listProjects",
        parameters: [{ name: "status", in: "query", schema: { type: "string" } }],
        responses: { "200": { description: "projects", content: { "application/json": { schema: okObject } } } },
      },
      post: {
        operationId: "createProject",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["name"],
            properties: { name: { type: "string" }, created_by: { type: "string" }, description: { type: "string" }, path: { type: "string" }, repository: { type: "string" } },
          } } },
        },
        responses: { "201": { description: "created", content: { "application/json": { schema: okObject } } } },
      },
    },
    "/v1/projects/{id}": {
      get: {
        operationId: "getProject",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "project", content: { "application/json": { schema: okObject } } } },
      },
      patch: {
        operationId: "updateProject",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { content: { "application/json": { schema: okObject } } },
        responses: { "200": { description: "updated", content: { "application/json": { schema: okObject } } } },
      },
      delete: {
        operationId: "deleteProject",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "deleted", content: { "application/json": { schema: okObject } } } },
      },
    },
    "/v1/agents": {
      get: {
        operationId: "listAgents",
        parameters: [{ name: "online_only", in: "query", schema: { type: "boolean" } }],
        responses: { "200": { description: "agents", content: { "application/json": { schema: okObject } } } },
      },
    },
    "/v1/agents/heartbeat": {
      post: {
        operationId: "heartbeat",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            properties: { agent: { type: "string" }, session_id: { type: "string" }, role: { type: "string" }, project_id: { type: "string" } },
          } } },
        },
        responses: { "200": { description: "presence", content: { "application/json": { schema: okObject } } } },
      },
    },
  },
} as const;

export type OpenApiSpec = typeof openapiSpec;
