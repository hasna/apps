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
          reply_to: { type: "integer", nullable: true },
          created_at: { type: "string" },
        },
      },
      ProjectMessageLinkageHash: {
        type: "object",
        required: ["id", "uuid", "hash", "preserved_hash"],
        properties: {
          id: { type: "integer" },
          uuid: { type: "string" },
          hash: { type: "string" },
          preserved_hash: { type: "string" },
        },
      },
      Channel: {
        type: "object",
        properties: {
          id: { type: "string" },
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
      ProjectPage: {
        type: "object",
        required: ["projects", "count", "cursor", "has_more", "next_cursor"],
        properties: {
          projects: { type: "array", items: { $ref: "#/components/schemas/Project" } },
          count: { type: "integer" },
          cursor: { type: "integer" },
          limit: { type: "integer", nullable: true },
          has_more: { type: "boolean" },
          next_cursor: { type: "integer", nullable: true },
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
        summary: "Package version and artifact-baked source SHA",
        security: [],
        responses: { "200": { description: "version", content: { "application/json": { schema: {
          type: "object",
          required: ["status", "version", "app", "build_sha"],
          properties: {
            status: { type: "string", const: "ok" },
            version: { type: "string" },
            app: { type: "string", const: "conversations" },
            build_sha: {
              oneOf: [
                { type: "string", pattern: "^[0-9a-f]{40}$" },
                { type: "null" },
              ],
            },
          },
        } } } } },
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
              uuid: { type: "string" },
              from: { type: "string" }, to: { type: "string" }, content: { type: "string" },
              channel: { type: "string" }, project_id: { type: "string" },
              session_id: { type: "string" }, priority: { type: "string" }, blocking: { type: "boolean" },
              reply_to: { type: "integer" },
              reply_to_uuid: { type: "string" },
              attachments: {
                type: "array",
                maxItems: 16,
                items: {
                  type: "object",
                  required: ["name", "content_base64"],
                  properties: {
                    name: { type: "string" },
                    content_base64: { type: "string", format: "byte" },
                  },
                },
              },
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
    "/v1/messages/{id}/attachments/{name}": {
      get: {
        operationId: "downloadMessageAttachment",
        summary: "Download one message attachment",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
          { name: "name", in: "path", required: true, schema: { type: "string" } },
          {
            name: "encoding",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["base64"] },
            description: "Return a JSON base64 envelope for JSON-only storage clients; omit for raw bytes.",
          },
        ],
        responses: {
          "200": {
            description: "attachment bytes",
            content: {
              "application/octet-stream": { schema: { type: "string", format: "binary" } },
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "mime_type", "size", "content_base64"],
                  properties: {
                    name: { type: "string" },
                    mime_type: { type: "string" },
                    size: { type: "integer" },
                    content_base64: { type: "string", format: "byte" },
                  },
                },
              },
            },
          },
          "404": { description: "not found" },
        },
      },
    },
    "/v1/messages/by-uuid/{uuid}": {
      get: {
        operationId: "getMessageByUuid",
        parameters: [{ name: "uuid", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "message", content: { "application/json": { schema: okObject } } } },
      },
    },
    "/v1/channels": {
      get: {
        operationId: "listChannels",
        parameters: [
          { name: "include_archived", in: "query", schema: { type: "boolean" } },
          { name: "project_id", in: "query", schema: { type: "string" } },
        ],
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
    "/v1/project-registration/channels/capability": {
      get: {
        operationId: "getProjectChannelRegistrationCapability",
        summary: "Read the package-owned conditional channel registration capability",
        responses: {
          "200": {
            description: "stable authority and corpus identity",
            content: { "application/json": { schema: okObject } },
          },
        },
      },
    },
    "/v1/project-registration/channels": {
      post: {
        operationId: "registerProjectChannel",
        summary: "Conditionally register one absent canonical project channel",
        requestBody: {
          required: true,
          content: { "application/json": { schema: okObject } },
        },
        responses: {
          "200": {
            description: "deterministic duplicate or terminal nonacceptance receipt",
            content: { "application/json": { schema: okObject } },
          },
          "201": {
            description: "immutable accepted receipt",
            content: { "application/json": { schema: okObject } },
          },
        },
      },
    },
    "/v1/project-registration/channels/receipts/terminal": {
      get: {
        operationId: "lookupProjectChannelRegistrationReceipt",
        summary: "Bounded exact terminal receipt lookup",
        parameters: [
          { name: "operation_id", in: "query", required: true, schema: { type: "string" } },
          { name: "step_id", in: "query", required: true, schema: { type: "string" } },
          { name: "resource_kind", in: "query", required: true, schema: { type: "string", enum: ["channel"] } },
          { name: "direction", in: "query", required: true, schema: { type: "string", enum: ["forward", "inverse"] } },
          { name: "authority", in: "query", required: true, schema: { type: "string", enum: ["conversations"] } },
          { name: "authority_route", in: "query", required: true, schema: { type: "string" } },
          { name: "package_version", in: "query", required: true, schema: { type: "string" } },
          { name: "authority_id", in: "query", required: true, schema: { type: "string" } },
          { name: "tenant_id", in: "query", required: true, schema: { type: "string" } },
          { name: "corpus_id", in: "query", required: true, schema: { type: "string" } },
          { name: "target_selector", in: "query", required: true, schema: { type: "string" } },
          { name: "idempotency_key", in: "query", required: true, schema: { type: "string" } },
          { name: "request_digest", in: "query", required: true, schema: { type: "string" } },
          { name: "precondition_digest", in: "query", required: true, schema: { type: "string" } },
          { name: "target_id", in: "query", schema: { type: "string" } },
          { name: "max_items", in: "query", required: true, schema: { type: "integer", const: 1 } },
          { name: "response_byte_limit", in: "query", required: true, schema: { type: "integer", minimum: 1 } },
          { name: "time_budget_ms", in: "query", required: true, schema: { type: "integer", minimum: 1 } },
          { name: "call_limit", in: "query", required: true, schema: { type: "integer", const: 1 } },
        ],
        responses: {
          "200": {
            description: "one complete receipt plus explicit response controls",
            content: { "application/json": { schema: okObject } },
          },
        },
      },
    },
    "/v1/project-registration/channels/{id}": {
      get: {
        operationId: "readProjectChannelRegistrationExact",
        summary: "Read one exact immutable channel id and canonical name",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^chn_[0-9a-f]{32}$" } },
          { name: "resource_kind", in: "query", required: true, schema: { type: "string", enum: ["channel"] } },
          { name: "target_selector", in: "query", schema: { type: "string" } },
          { name: "target_digest", in: "query", required: true, schema: { type: "string" } },
          { name: "response_byte_limit", in: "query", required: true, schema: { type: "integer", minimum: 1 } },
          { name: "time_budget_ms", in: "query", required: true, schema: { type: "integer", minimum: 1 } },
          { name: "call_limit", in: "query", required: true, schema: { type: "integer", const: 1 } },
        ],
        responses: {
          "200": {
            description: "exact id/revision/digest readback",
            content: { "application/json": { schema: okObject } },
          },
          "404": { description: "target not found" },
        },
      },
    },
    "/v1/project-registration/channels/inverse": {
      post: {
        operationId: "compensateProjectChannelRegistration",
        summary: "Conditionally remove only the channel created by one accepted receipt",
        requestBody: {
          required: true,
          content: { "application/json": { schema: okObject } },
        },
        responses: {
          "200": {
            description: "deterministic duplicate or terminal nonacceptance receipt",
            content: { "application/json": { schema: okObject } },
          },
          "201": {
            description: "immutable accepted inverse receipt",
            content: { "application/json": { schema: okObject } },
          },
        },
      },
    },
    "/v1/project-registration/channels/inverse/verify": {
      post: {
        operationId: "verifyProjectChannelRegistrationInverse",
        summary: "Verify exact target absence against the accepted forward receipt",
        requestBody: {
          required: true,
          content: { "application/json": { schema: okObject } },
        },
        responses: {
          "200": {
            description: "receipt-bound exact absence verification",
            content: { "application/json": { schema: okObject } },
          },
        },
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
    "/v1/channels/{name}/project-message-linkage": {
      post: {
        operationId: "applyChannelProjectMessageLinkage",
        summary: "Plan or apply guarded project linkage for every message in one exact project-linked channel",
        description:
          "With apply=false, returns a non-mutating complete-membership snapshot and revision. " +
          "With apply=true, expected_revision and idempotency_key are required; the server locks " +
          "the channel and its message rows, appends an immutable receipt, and updates only null project_id values.",
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            additionalProperties: false,
            required: ["project_id", "apply"],
            properties: {
              project_id: { type: "string" },
              apply: { type: "boolean" },
              expected_revision: { type: "string" },
              idempotency_key: { type: "string" },
            },
          } } },
        },
        responses: {
          "200": { description: "dry-run plan or idempotent replay", content: { "application/json": { schema: okObject } } },
          "201": { description: "immutable apply receipt", content: { "application/json": { schema: okObject } } },
          "409": { description: "stale revision, conflicting project, or inconsistent idempotency key", content: { "application/json": { schema: errorObject } } },
        },
      },
    },
    "/v1/channels/project-message-linkage/rollback": {
      post: {
        operationId: "rollbackChannelProjectMessageLinkage",
        summary: "Plan or apply an exact conditional rollback from an immutable linkage receipt",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            additionalProperties: false,
            required: ["receipt_id", "expected_revision", "idempotency_key", "apply"],
            properties: {
              receipt_id: { type: "string" },
              expected_revision: { type: "string" },
              idempotency_key: { type: "string" },
              apply: { type: "boolean" },
            },
          } } },
        },
        responses: {
          "200": { description: "dry-run plan or idempotent replay", content: { "application/json": { schema: okObject } } },
          "201": { description: "immutable rollback receipt", content: { "application/json": { schema: okObject } } },
          "409": { description: "stale target rows or inconsistent idempotency key", content: { "application/json": { schema: errorObject } } },
        },
      },
    },
    "/v1/projects": {
      get: {
        operationId: "listProjects",
        parameters: [
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000 } },
          { name: "cursor", in: "query", description: "Zero-based continuation offset", schema: { type: "integer", minimum: 0 } },
          { name: "offset", in: "query", description: "Alias for cursor", schema: { type: "integer", minimum: 0 } },
        ],
        responses: {
          "200": {
            description: "project page",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ProjectPage" } } },
          },
          "400": { description: "invalid pagination", content: { "application/json": { schema: errorObject } } },
        },
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
