/**
 * OpenAPI 3.1 description of the conversations-serve /v1 API.
 * Single source of truth for the generated SDK (scripts/generate-sdk.ts) and
 * the /v1/openapi.json discovery endpoint.
 */

import { version as pkgVersion } from "../../package.json";

const okObject = { type: "object", additionalProperties: true } as const;

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
          reply_to: { type: "integer", nullable: true },
          working_dir: { type: "string", nullable: true },
          repository: { type: "string", nullable: true },
          branch: { type: "string", nullable: true },
          metadata: { type: "object", nullable: true, additionalProperties: true },
          attachments: { type: "array", nullable: true, items: { type: "object", additionalProperties: true } },
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
      IncidentSnapshotV1: {
        type: "object",
        additionalProperties: false,
        required: [
          "id", "title", "severity", "status", "owner", "affected_scopes", "blocked_scopes",
          "containment", "next_action", "deadline", "closure_evidence", "supersedes_id",
          "superseded_by_id", "resolved_at", "version", "created_at", "updated_at",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string", maxLength: 200 },
          severity: { type: "string", enum: ["info", "low", "medium", "high", "critical"] },
          status: { type: "string", enum: ["open", "investigating", "contained", "monitoring", "resolved", "superseded"] },
          owner: { type: "string", maxLength: 128 },
          affected_scopes: { type: "array", minItems: 1, maxItems: 64, items: { type: "string", maxLength: 256 } },
          blocked_scopes: {
            type: "array",
            maxItems: 64,
            items: {
              type: "string",
              maxLength: 128,
              pattern: "^(?:agent:[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}|channel:[a-z0-9]+(?:-[a-z0-9]+)*|project:[A-Za-z0-9][A-Za-z0-9_-]{0,119})$",
            },
          },
          containment: { type: "string", nullable: true, maxLength: 4000 },
          next_action: { type: "string", nullable: true, maxLength: 4000 },
          deadline: { type: "string", format: "date-time", nullable: true },
          closure_evidence: { type: "array", maxItems: 64, items: { type: "string", maxLength: 256 } },
          supersedes_id: { type: "string", format: "uuid", nullable: true },
          superseded_by_id: { type: "string", format: "uuid", nullable: true },
          resolved_at: { type: "string", format: "date-time", nullable: true },
          version: { type: "integer", minimum: 1 },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      IncidentProjectionEventV1: {
        type: "object",
        additionalProperties: false,
        required: [
          "schema_version", "source", "authority_id", "incident_id", "transition_id",
          "incident_version", "occurred_at", "event_id", "projection_key", "incident",
        ],
        properties: {
          schema_version: { type: "integer", enum: [1] },
          source: { type: "string", enum: ["todos"] },
          authority_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          incident_id: { type: "string", format: "uuid" },
          transition_id: { type: "string", pattern: "^itr_[0-9a-f]{32}$" },
          incident_version: { type: "integer", minimum: 1 },
          occurred_at: { type: "string", format: "date-time" },
          event_id: { type: "string", pattern: "^iev_[0-9a-f]{32}$" },
          projection_key: { type: "string", pattern: "^todos:incident:" },
          incident: { $ref: "#/components/schemas/IncidentSnapshotV1" },
        },
      },
      IncidentProjectionRecord: {
        type: "object",
        required: [
          "id", "event_id", "projection_key", "message_id", "schema_version", "source", "tenant_id",
          "authority_id", "incident_id", "transition_id", "incident_version", "occurred_at", "status",
          "severity", "blocking", "supersedes_transition_id", "supersedes_incident_id",
          "superseded_by_incident_id", "canonical_payload", "payload_hash", "created_at", "message", "replayed",
        ],
        properties: {
          id: { type: "integer" }, event_id: { type: "string" }, projection_key: { type: "string" },
          message_id: { type: "integer" }, schema_version: { type: "integer", enum: [1] }, source: { type: "string", enum: ["todos"] },
          tenant_id: { type: "string" }, authority_id: { type: "string" }, incident_id: { type: "string", format: "uuid" },
          transition_id: { type: "string" }, incident_version: { type: "integer" }, occurred_at: { type: "string", format: "date-time" },
          status: { type: "string", enum: ["open", "investigating", "contained", "monitoring", "resolved", "superseded"] },
          severity: { type: "string", enum: ["info", "low", "medium", "high", "critical"] },
          blocking: { type: "boolean" }, supersedes_transition_id: { type: "string", nullable: true },
          supersedes_incident_id: { type: "string", format: "uuid", nullable: true },
          superseded_by_incident_id: { type: "string", format: "uuid", nullable: true },
          canonical_payload: { type: "string" }, payload_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          created_at: { type: "string", format: "date-time" }, message: { $ref: "#/components/schemas/Message" },
          replayed: { type: "boolean" },
        },
      },
      IncidentProjectionResponse: {
        type: "object",
        required: ["projection"],
        properties: { projection: { $ref: "#/components/schemas/IncidentProjectionRecord" } },
      },
      IncidentProjectionError: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "string" }, code: { type: "string", nullable: true } },
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
    "/v1/incident-projections": {
      post: {
        operationId: "appendIncidentProjection",
        summary: "Append a canonical Todos incident projection",
        description:
          "Dedicated append-only projector route. Requires the conversations:incident-project scope. " +
          "Returns 201 for a new event and 200 for an identical idempotent replay.",
        "x-required-scope": "conversations:incident-project",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/IncidentProjectionEventV1" } } },
        },
        responses: {
          "200": { description: "identical replay", content: { "application/json": { schema: { $ref: "#/components/schemas/IncidentProjectionResponse" } } } },
          "201": { description: "projection appended", content: { "application/json": { schema: { $ref: "#/components/schemas/IncidentProjectionResponse" } } } },
          "400": { description: "invalid projection", content: { "application/json": { schema: { $ref: "#/components/schemas/IncidentProjectionError" } } } },
          "409": { description: "canonical projection conflict", content: { "application/json": { schema: { $ref: "#/components/schemas/IncidentProjectionError" } } } },
          "503": { description: "projector authority or storage temporarily unavailable", content: { "application/json": { schema: { $ref: "#/components/schemas/IncidentProjectionError" } } } },
        },
      },
    },
    "/v1/incident-projections/{event_id}": {
      get: {
        operationId: "getIncidentProjection",
        summary: "Read one canonical incident projection",
        parameters: [{ name: "event_id", in: "path", required: true, schema: { type: "string", pattern: "^iev_[0-9a-f]{32}$" } }],
        responses: {
          "200": { description: "projection", content: { "application/json": { schema: { $ref: "#/components/schemas/IncidentProjectionResponse" } } } },
          "404": { description: "not found", content: { "application/json": { schema: { $ref: "#/components/schemas/IncidentProjectionError" } } } },
          "503": { description: "projector authority or storage temporarily unavailable", content: { "application/json": { schema: { $ref: "#/components/schemas/IncidentProjectionError" } } } },
        },
      },
    },
    "/v1/messages/blockers": {
      get: {
        operationId: "listUnreadBlockers",
        summary: "List canonical current blockers visible to one agent",
        parameters: [
          { name: "agent", in: "query", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "blockers", content: { "application/json": { schema: okObject } } } },
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
          { name: "count", in: "query", description: "When set, return { count } (honours the same filters) instead of rows.", schema: { type: "boolean" } },
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
              reply_to: { type: "integer" }, metadata: { type: "object", additionalProperties: true },
              working_dir: { type: "string" }, repository: { type: "string" }, branch: { type: "string" },
              attachments: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          } } },
        },
        responses: { "201": { description: "created", content: { "application/json": { schema: okObject } } } },
      },
    },
    "/v1/messages/bulk": {
      post: {
        operationId: "bulkIngestMessages",
        summary: "Bulk-ingest messages (idempotent backfill)",
        description:
          "Insert many messages in one request, preserving each message's uuid and " +
          "created_at. Idempotent via ON CONFLICT (uuid) DO NOTHING — re-running never " +
          "duplicates. Requires the conversations:write scope. Returns { requested, " +
          "inserted, skipped, total } where total is the authoritative post-insert count.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            required: ["messages"],
            properties: {
              messages: {
                type: "array",
                maxItems: 2000,
                items: {
                  type: "object",
                  required: ["uuid", "from", "to", "content"],
                  properties: {
                    uuid: { type: "string" },
                    from: { type: "string" },
                    to: { type: "string" },
                    content: { type: "string" },
                    channel: { type: "string" },
                    project_id: { type: "string" },
                    session_id: { type: "string" },
                    priority: { type: "string" },
                    blocking: { type: "boolean" },
                    created_at: { type: "string" },
                    read_at: { type: "string" },
                    edited_at: { type: "string" },
                    pinned_at: { type: "string" },
                    working_dir: { type: "string" },
                    repository: { type: "string" },
                    branch: { type: "string" },
                    metadata: { type: "string" },
                    attachments: { type: "string" },
                    reply_to: { type: "integer" },
                  },
                },
              },
            },
          } } },
        },
        responses: { "200": { description: "ingest result", content: { "application/json": { schema: okObject } } } },
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
            properties: { name: { type: "string" }, created_by: { type: "string" }, description: { type: "string" }, topic: { type: "string" }, project_id: { type: "string" } },
          } } },
        },
        responses: { "201": { description: "created", content: { "application/json": { schema: okObject } } } },
      },
    },
    "/v1/channels/mine": {
      get: {
        operationId: "listMemberChannels",
        parameters: [{ name: "agent", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "member channels with unread counts", content: { "application/json": { schema: okObject } } } },
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
