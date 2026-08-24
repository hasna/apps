/**
 * OpenAPI 3.1 description of the conversations-serve /v1 API.
 * Single source of truth for the generated SDK (scripts/generate-sdk.ts) and
 * the /v1/openapi.json discovery endpoint.
 */

import { version as pkgVersion } from "../../package.json";

const okObject = { type: "object", additionalProperties: true } as const;
const projectChannelCreateRequest = {
  type: "object",
  additionalProperties: {},
  required: [],
  properties: {
    operation_intent: { type: "string", enum: ["create"] },
  },
} as const;
const projectChannelBindRequest = {
  type: "object",
  additionalProperties: {},
  required: ["operation_intent", "bind_existing"],
  properties: {
    operation_intent: { type: "string", enum: ["bind_existing"] },
    bind_existing: { type: "object", additionalProperties: true },
  },
} as const;
const projectChannelMessageOwnershipSnapshot = {
  type: "object",
  additionalProperties: false,
  required: [
    "message_count",
    "first_message_id",
    "last_message_id",
    "message_ids_digest",
    "message_project_digest",
    "digest",
    "preserved_digest",
  ],
  properties: {
    message_count: { type: "integer", minimum: 0 },
    first_message_id: { anyOf: [{ type: "integer" }, { type: "null" }] },
    last_message_id: { anyOf: [{ type: "integer" }, { type: "null" }] },
    message_ids_digest: { type: "string", pattern: "^[0-9a-f]{64}$" },
    message_project_digest: { type: "string", pattern: "^[0-9a-f]{64}$" },
    digest: { type: "string", pattern: "^[0-9a-f]{64}$" },
    preserved_digest: { type: "string", pattern: "^[0-9a-f]{64}$" },
  },
} as const;
const projectChannelAdoptRequest = {
  type: "object",
  additionalProperties: {},
  required: ["operation_intent", "adopt_existing"],
  properties: {
    operation_intent: { type: "string", enum: ["adopt_existing"] },
    adopt_existing: {
      type: "object",
      additionalProperties: false,
      required: [
        "target_id",
        "expected_project_id",
        "expected_revision",
        "expected_digest",
        "expected_message_ownership",
      ],
      properties: {
        target_id: { type: "string", pattern: "^chn_[0-9a-f]{32}$" },
        expected_project_id: { type: "string", minLength: 1 },
        expected_revision: { type: "string", minLength: 1 },
        expected_digest: { type: "string", pattern: "^[0-9a-f]{64}$" },
        expected_message_ownership: projectChannelMessageOwnershipSnapshot,
      },
    },
  },
} as const;
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
    description: "Conversations HTTP API (API-key authenticated).",
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
      MessagePreview: {
        type: "object",
        additionalProperties: false,
        required: [
          "id", "session_id", "from_agent", "to_agent", "channel", "project_id", "priority",
          "working_dir", "repository", "branch", "created_at", "edited_at", "pinned_at", "unread",
          "blocking", "reply_to", "attachment_count", "has_attachments", "has_metadata", "preview",
          "preview_bytes", "content_bytes", "truncated", "redacted",
        ],
        properties: {
          id: { type: "integer" },
          mention_id: { type: "integer", minimum: 1, description: "Mention-row id on dedicated mention projections; distinct from id." },
          uuid: { type: "string" },
          session_id: { type: "string" },
          from_agent: { type: "string" },
          to_agent: { type: "string" },
          channel: { type: "string", nullable: true },
          project_id: { type: "string", nullable: true },
          priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
          working_dir: { type: "string", nullable: true },
          repository: { type: "string", nullable: true },
          branch: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time" },
          edited_at: { type: "string", nullable: true },
          pinned_at: { type: "string", nullable: true },
          unread: { type: "boolean" },
          blocking: { type: "boolean" },
          reply_to: { type: "integer", nullable: true },
          reply_count: { type: "integer" },
          attachment_count: { type: "integer" },
          has_attachments: { type: "boolean" },
          has_metadata: { type: "boolean" },
          preview: { type: "string" },
          preview_bytes: { type: "integer" },
          content_bytes: { type: "integer" },
          truncated: { type: "boolean" },
          redacted: { type: "boolean" },
          relevance_score: { type: "number" },
        },
      },
      MessagePreviewPage: {
        type: "object",
        additionalProperties: false,
        required: [
          "messages", "count", "limit", "cursor", "next_cursor", "has_more", "skipped_count",
          "byte_length", "max_bytes", "timeout_ms", "compact", "detail_path",
        ],
        properties: {
          messages: { type: "array", items: { $ref: "#/components/schemas/MessagePreview" } },
          count: { type: "integer" },
          limit: { type: "integer", maximum: 100 },
          cursor: { type: "integer", minimum: 0 },
          next_cursor: { type: "integer", nullable: true },
          has_more: { type: "boolean" },
          skipped_count: { type: "integer" },
          byte_length: { type: "integer" },
          max_bytes: { type: "integer", maximum: 65536 },
          timeout_ms: { type: "integer", maximum: 5000 },
          compact: { type: "boolean", enum: [true] },
          detail_path: { type: "string", enum: ["messages/{id}"] },
          query: { type: "string" },
        },
      },
      MessageResponse: {
        type: "object",
        required: ["message"],
        properties: { message: { $ref: "#/components/schemas/Message" } },
      },
      ChannelNotification: {
        type: "object",
        additionalProperties: false,
        required: ["message_id", "channel", "from_agent", "created_at", "priority", "preview", "unread", "has_attachments"],
        properties: {
          message_id: { type: "integer" },
          channel: { type: "string" },
          from_agent: { type: "string" },
          created_at: { type: "string", format: "date-time" },
          priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
          preview: { type: "string" },
          unread: { type: "boolean" },
          has_attachments: { type: "boolean" },
        },
      },
      ChannelNotificationPage: {
        type: "object",
        additionalProperties: false,
        required: [
          "notifications", "count", "limit", "cursor", "next_cursor", "has_more", "skipped_count",
          "byte_length", "max_bytes", "timeout_ms", "marked_read", "compact", "detail_path",
        ],
        properties: {
          notifications: { type: "array", items: { $ref: "#/components/schemas/ChannelNotification" } },
          count: { type: "integer" },
          limit: { type: "integer", maximum: 100 },
          cursor: { type: "integer", minimum: 0 },
          next_cursor: { type: "integer", nullable: true },
          has_more: { type: "boolean" },
          skipped_count: { type: "integer" },
          byte_length: { type: "integer" },
          max_bytes: { type: "integer", maximum: 65536 },
          timeout_ms: { type: "integer", maximum: 5000 },
          marked_read: { type: "integer" },
          compact: { type: "boolean", enum: [true] },
          detail_path: { type: "string", enum: ["messages/{id}"] },
        },
      },
      MessageExportRequest: {
        type: "object",
        additionalProperties: false,
        properties: {
          channel: { type: "string" },
          session_id: { type: "string" },
          from: { type: "string" },
          since: { type: "string", format: "date-time" },
          until: { type: "string", format: "date-time" },
          format: { type: "string", enum: ["json", "csv"], default: "json" },
          detail: { type: "string", enum: ["preview"], default: "preview" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          max_bytes: { type: "integer", minimum: 512, maximum: 65536 },
          preview_bytes: { type: "integer", minimum: 1, maximum: 1024 },
          timeout_ms: { type: "integer", minimum: 1, maximum: 5000 },
        },
      },
      MessageExportArtifact: {
        type: "object",
        additionalProperties: false,
        required: [
          "artifact_id", "filename", "path", "download_path", "sha256", "format", "detail", "count",
          "has_more", "skipped_count", "byte_length", "max_bytes", "timeout_ms", "created_at",
        ],
        properties: {
          artifact_id: { type: "string", format: "uuid" },
          filename: { type: "string" },
          path: { type: "string", nullable: true, description: "Always null on the HTTP API." },
          download_path: { type: "string", nullable: true },
          sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          format: { type: "string", enum: ["json", "csv"] },
          detail: { type: "string", enum: ["preview"] },
          count: { type: "integer" },
          has_more: { type: "boolean" },
          skipped_count: { type: "integer" },
          byte_length: { type: "integer", maximum: 65536 },
          max_bytes: { type: "integer", maximum: 65536 },
          timeout_ms: { type: "integer", maximum: 5000 },
          created_at: { type: "string", format: "date-time" },
        },
      },
      MessageExportArtifactResponse: {
        type: "object",
        additionalProperties: false,
        required: ["artifact"],
        properties: { artifact: { $ref: "#/components/schemas/MessageExportArtifact" } },
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
      ProjectChannelCollectionItem: {
        type: "object",
        required: [
          "authority",
          "resource_kind",
          "scope",
          "project_id",
          "channel",
          "target_id",
          "revision",
          "digest",
        ],
        properties: {
          authority: { type: "string", const: "conversations" },
          resource_kind: { type: "string", const: "channel" },
          scope: { type: "string", const: "collection" },
          project_id: { type: "string" },
          channel: { type: "string" },
          target_id: { type: "string", pattern: "^chn_[0-9a-f]{32}$" },
          revision: { type: "string" },
          digest: { type: "string" },
        },
      },
      ProjectChannelCollectionPage: {
        type: "object",
        required: [
          "authority",
          "resource_kind",
          "scope",
          "project_id",
          "collection_revision",
          "items",
          "cursor",
          "next_cursor",
          "cursor_semantics",
          "max_items",
          "item_count",
          "has_more",
          "complete",
          "truncated",
          "response_bytes",
          "elapsed_ms",
        ],
        properties: {
          authority: { type: "string", const: "conversations" },
          resource_kind: { type: "string", const: "channel" },
          scope: { type: "string", const: "collection" },
          project_id: { type: "string" },
          collection_revision: { type: "string", pattern: "^[0-9a-f]{64}$" },
          items: {
            type: "array",
            items: { $ref: "#/components/schemas/ProjectChannelCollectionItem" },
          },
          cursor: { type: "string", nullable: true },
          next_cursor: { type: "string", nullable: true },
          cursor_semantics: { type: "string", const: "exclusive_stable_id" },
          max_items: { type: "integer", minimum: 1, maximum: 1000 },
          item_count: { type: "integer", minimum: 0 },
          has_more: { type: "boolean" },
          complete: { type: "boolean" },
          truncated: { type: "boolean" },
          response_bytes: { type: "integer", minimum: 0 },
          elapsed_ms: { type: "integer", minimum: 0 },
        },
      },
      ProjectChannelMessageCollectionItem: {
        type: "object",
        required: [
          "authority",
          "resource_kind",
          "scope",
          "target_id",
          "local_id",
          "channel_id",
          "channel",
          "project_id",
          "reply_to_target_id",
          "revision",
          "digest",
        ],
        properties: {
          authority: { type: "string", const: "conversations" },
          resource_kind: { type: "string", const: "message" },
          scope: { type: "string", const: "resource" },
          target_id: { type: "string" },
          local_id: { type: "integer", minimum: 1 },
          channel_id: { type: "string", pattern: "^chn_[0-9a-f]{32}$" },
          channel: { type: "string" },
          project_id: { type: "string" },
          reply_to_target_id: { type: "string", nullable: true },
          revision: { type: "string" },
          digest: { type: "string" },
        },
      },
      ProjectChannelMessageCollectionPage: {
        type: "object",
        required: [
          "authority",
          "resource_kind",
          "scope",
          "project_id",
          "channel_id",
          "channel",
          "items",
          "cursor",
          "next_cursor",
          "cursor_semantics",
          "max_items",
          "item_count",
          "has_more",
          "complete",
          "truncated",
          "response_bytes",
          "elapsed_ms",
        ],
        properties: {
          authority: { type: "string", const: "conversations" },
          resource_kind: { type: "string", const: "message" },
          scope: { type: "string", const: "collection" },
          project_id: { type: "string" },
          channel_id: { type: "string", pattern: "^chn_[0-9a-f]{32}$" },
          channel: { type: "string" },
          items: {
            type: "array",
            items: { $ref: "#/components/schemas/ProjectChannelMessageCollectionItem" },
          },
          cursor: { type: "integer", nullable: true },
          next_cursor: { type: "integer", nullable: true },
          cursor_semantics: { type: "string", const: "exclusive_local_id" },
          max_items: { type: "integer", minimum: 1, maximum: 1000 },
          item_count: { type: "integer", minimum: 0 },
          has_more: { type: "boolean" },
          complete: { type: "boolean" },
          truncated: { type: "boolean" },
          response_bytes: { type: "integer", minimum: 0 },
          elapsed_ms: { type: "integer", minimum: 0 },
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
          id: { type: "integer" },
          event_id: { type: "string" },
          projection_key: { type: "string" },
          message_id: { type: "integer" },
          schema_version: { type: "integer", enum: [1] },
          source: { type: "string", enum: ["todos"] },
          tenant_id: { type: "string" },
          authority_id: { type: "string" },
          incident_id: { type: "string", format: "uuid" },
          transition_id: { type: "string" },
          incident_version: { type: "integer" },
          occurred_at: { type: "string", format: "date-time" },
          status: { type: "string", enum: ["open", "investigating", "contained", "monitoring", "resolved", "superseded"] },
          severity: { type: "string", enum: ["info", "low", "medium", "high", "critical"] },
          blocking: { type: "boolean" },
          supersedes_transition_id: { type: "string", nullable: true },
          supersedes_incident_id: { type: "string", format: "uuid", nullable: true },
          superseded_by_incident_id: { type: "string", format: "uuid", nullable: true },
          canonical_payload: { type: "string" },
          payload_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          created_at: { type: "string", format: "date-time" },
          message: { $ref: "#/components/schemas/Message" },
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
        properties: {
          error: { type: "string" },
          code: { type: "string", nullable: true },
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
        summary: "List bounded, redacted current-blocker previews visible to one agent",
        description: "The API key is the fleet-level authorization principal; the declared byline is the identity the read is scoped to. The `agent` query scopes the blockers read to that agent (omitted: the key's own claim). The caller-declared byline is forwarded unconditionally — omitting it was the fleet-wide unscoped read (task 1871c67f).",
        parameters: [
          { name: "agent", in: "query", required: false, schema: { type: "string" }, description: "Agent the blockers read is scoped to. Omitted: the API key's own claim." },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0 } },
          { name: "max_bytes", in: "query", schema: { type: "integer", minimum: 512, maximum: 65536 } },
          { name: "preview_bytes", in: "query", schema: { type: "integer", minimum: 1, maximum: 1024 } },
          { name: "timeout_ms", in: "query", schema: { type: "integer", minimum: 1, maximum: 5000 } },
        ],
        responses: { "200": { description: "bounded blocker previews", content: { "application/json": { schema: { $ref: "#/components/schemas/MessagePreviewPage" } } } } },
      },
    },
    "/v1/messages": {
      get: {
        operationId: "listMessages",
        summary: "List bounded, redacted message previews",
        description: "Full content, raw metadata, and raw attachments never enter this collection response; use GET /v1/messages/{id} for one exact message.",
        parameters: [
          { name: "to", in: "query", schema: { type: "string" } },
          { name: "from", in: "query", schema: { type: "string" } },
          { name: "channel", in: "query", schema: { type: "string" } },
          { name: "session", in: "query", schema: { type: "string" } },
          { name: "project_id", in: "query", schema: { type: "string" } },
          { name: "id", in: "query", schema: { type: "integer", minimum: 1 } },
          { name: "uuid", in: "query", schema: { type: "string" } },
          { name: "since_id", in: "query", schema: { type: "integer", minimum: 0 } },
          { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "until", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0 } },
          { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "mentions_only", in: "query", schema: { type: "string" } },
          { name: "unread_only", in: "query", schema: { type: "boolean" } },
          { name: "threads_only", in: "query", schema: { type: "boolean" } },
          { name: "pinned_only", in: "query", schema: { type: "boolean" } },
          { name: "blocking_only", in: "query", schema: { type: "boolean" } },
          { name: "reply_to", in: "query", schema: { type: "integer", minimum: 1 } },
          { name: "include_reply_counts", in: "query", schema: { type: "boolean" } },
          { name: "max_bytes", in: "query", schema: { type: "integer", minimum: 512, maximum: 65536 } },
          { name: "preview_bytes", in: "query", schema: { type: "integer", minimum: 1, maximum: 1024 } },
          { name: "timeout_ms", in: "query", schema: { type: "integer", minimum: 1, maximum: 5000 } },
          { name: "count", in: "query", description: "When set, return { count } (honours the same filters) instead of rows.", schema: { type: "boolean" } },
        ],
        responses: { "200": { description: "bounded message previews", content: { "application/json": { schema: { $ref: "#/components/schemas/MessagePreviewPage" } } } } },
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
              working_dir: { type: "string" }, repository: { type: "string" }, branch: { type: "string" },
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
    "/v1/messages/exports": {
      post: {
        operationId: "createMessageExport",
        summary: "Create a bounded preview-only message export artifact",
        requestBody: {
          required: false,
          content: { "application/json": { schema: { $ref: "#/components/schemas/MessageExportRequest" } } },
        },
        responses: {
          "201": { description: "artifact created", content: { "application/json": { schema: { $ref: "#/components/schemas/MessageExportArtifactResponse" } } } },
          "400": { description: "malformed or unsafe full-detail request", content: { "application/json": { schema: errorObject } } },
        },
      },
    },
    "/v1/messages/exports/{artifact_id}": {
      get: {
        operationId: "downloadMessageExport",
        summary: "Download one bounded preview artifact owned by the authenticated principal",
        parameters: [{ name: "artifact_id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "bounded preview artifact payload",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/MessagePreview" } },
              },
              "text/csv": { schema: { type: "string" } },
            },
          },
          "404": { description: "missing or not owned by this principal", content: { "application/json": { schema: errorObject } } },
        },
      },
    },
    "/v1/channel-notifications/inbox": {
      get: {
        operationId: "readChannelNotifications",
        summary: "Read a bounded, cursored page of notifications for the authenticated principal",
        description: "The `agent` query is the identity the inbox is scoped to (required; the API key authorizes, the byline scopes — task 1871c67f). mark_read acknowledges only notification ids returned in this page.",
        parameters: [
          { name: "agent", in: "query", required: true, schema: { type: "string" }, description: "Agent whose notification inbox is read. The API key authorizes; this byline scopes." },
          { name: "channel", in: "query", schema: { type: "string" } },
          { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "unread_only", in: "query", schema: { type: "boolean" } },
          { name: "mark_read", in: "query", schema: { type: "boolean" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { name: "cursor", in: "query", schema: { type: "integer", minimum: 0 } },
          { name: "max_bytes", in: "query", schema: { type: "integer", minimum: 512, maximum: 65536 } },
          { name: "preview_bytes", in: "query", schema: { type: "integer", minimum: 1, maximum: 1024 } },
          { name: "timeout_ms", in: "query", schema: { type: "integer", minimum: 1, maximum: 5000 } },
        ],
        responses: {
          "200": { description: "notification page", content: { "application/json": { schema: { $ref: "#/components/schemas/ChannelNotificationPage" } } } },
          "400": { description: "agent is required", content: { "application/json": { schema: errorObject } } },
        },
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
        responses: { "200": { description: "message", content: { "application/json": { schema: { $ref: "#/components/schemas/MessageResponse" } } } } },
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
    "/v1/threads": {
      get: {
        operationId: "listThreads",
        summary: "List reply threads in a channel",
        description: "Each thread root with its full descendant reply count, last activity, open/closed status and — with `from` — the reader's unread count.",
        parameters: [
          { name: "channel", in: "query", required: true, schema: { type: "string" } },
          { name: "from", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0 } },
        ],
        responses: { "200": { description: "thread list", content: { "application/json": { schema: okObject } } } },
      },
    },
    "/v1/threads/{id}": {
      get: {
        operationId: "expandThread",
        summary: "Expand one thread into its full nested reply tree",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
        responses: { "200": { description: "thread root and nested replies", content: { "application/json": { schema: okObject } } } },
      },
    },
    "/v1/threads/{id}/status": {
      post: {
        operationId: "setThreadStatus",
        summary: "Close or reopen a thread",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            required: ["status"],
            properties: { status: { type: "string", enum: ["open", "closed"] } },
          } } },
        },
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
        responses: { "200": { description: "updated thread root", content: { "application/json": { schema: okObject } } } },
      },
    },
    "/v1/threads/{id}/unread": {
      get: {
        operationId: "getThreadUnread",
        summary: "Per-agent unread count for one thread",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } },
          { name: "agent", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "unread count", content: { "application/json": { schema: okObject } } } },
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
      get: {
        operationId: "listProjectChannelRegistrations",
        summary: "List one bounded page of project-owned channel registrations",
        parameters: [
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "cursor", in: "query", schema: { type: "string", pattern: "^chn_[0-9a-f]{32}$" } },
          {
            name: "collection_revision",
            in: "query",
            description: "Required with cursor; the collection revision returned by the first page",
            schema: { type: "string", pattern: "^[0-9a-f]{64}$" },
          },
          { name: "max_items", in: "query", required: true, schema: { type: "integer", minimum: 1, maximum: 1000 } },
          { name: "response_byte_limit", in: "query", required: true, schema: { type: "integer", minimum: 1 } },
          { name: "time_budget_ms", in: "query", required: true, schema: { type: "integer", minimum: 1 } },
          { name: "call_limit", in: "query", required: true, schema: { type: "integer", const: 1 } },
        ],
        responses: {
          "200": {
            description: "stable-id ordered page with explicit completeness metadata",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProjectChannelCollectionPage" },
              },
            },
          },
          "409": {
            description: "project channel collection changed; restart from the first page",
            content: { "application/json": { schema: errorObject } },
          },
        },
      },
      post: {
        operationId: "registerProjectChannel",
        summary: "Conditionally create one absent canonical project channel",
        requestBody: {
          required: true,
          content: { "application/json": { schema: projectChannelCreateRequest } },
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
    "/v1/project-registration/channels/bind-existing": {
      post: {
        operationId: "bindExistingProjectChannel",
        summary: "Conditionally bind one exact existing channel to a Projects workspace",
        description:
          "Requires the stable channel id, exact prior project ownership, and exact prior revision/digest. " +
          "The accepted immutable receipt retains the prior channel and message ownership state for a conditional inverse.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: projectChannelBindRequest } },
        },
        responses: {
          "200": {
            description: "deterministic duplicate or terminal nonacceptance receipt",
            content: { "application/json": { schema: okObject } },
          },
          "201": {
            description: "immutable accepted bind-existing receipt",
            content: { "application/json": { schema: okObject } },
          },
        },
      },
    },
    "/v1/project-registration/channels/adopt-existing": {
      post: {
        operationId: "adoptExistingProjectChannel",
        summary: "Conditionally adopt one exact pre-bound channel without changing its content",
        description:
          "Requires the stable channel id, exact current project ownership, channel revision/digest, and complete message ownership snapshot. " +
          "The accepted immutable receipt records a no-op adoption and the inverse verifies the same state without clobbering it.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: projectChannelAdoptRequest } },
        },
        responses: {
          "200": {
            description: "deterministic duplicate or terminal nonacceptance receipt",
            content: { "application/json": { schema: okObject } },
          },
          "201": {
            description: "immutable accepted adopt-existing receipt",
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
          { name: "precondition_kind", in: "query", schema: { type: "string", enum: ["absent", "bind_existing", "adopt_existing"] } },
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
    "/v1/project-registration/channels/{id}/messages": {
      get: {
        operationId: "listProjectChannelMessages",
        summary: "List one bounded page of messages inherited from a project-owned channel",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^chn_[0-9a-f]{32}$" } },
          { name: "project_id", in: "query", required: true, schema: { type: "string" } },
          { name: "cursor", in: "query", schema: { type: "integer", minimum: 0 } },
          { name: "max_items", in: "query", required: true, schema: { type: "integer", minimum: 1, maximum: 1000 } },
          { name: "response_byte_limit", in: "query", required: true, schema: { type: "integer", minimum: 1 } },
          { name: "time_budget_ms", in: "query", required: true, schema: { type: "integer", minimum: 1 } },
          { name: "call_limit", in: "query", required: true, schema: { type: "integer", const: 1 } },
        ],
        responses: {
          "200": {
            description: "exclusive-id page of immutable message UUID membership",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProjectChannelMessageCollectionPage" },
              },
            },
          },
          "400": {
            description: "channel/message project linkage conflict",
            content: { "application/json": { schema: errorObject } },
          },
        },
      },
    },
    "/v1/project-registration/channels/inverse": {
      post: {
        operationId: "compensateProjectChannelRegistration",
        summary: "Conditionally remove an operation-created channel or restore prior ownership",
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
        summary: "Verify exact target absence or restored ownership against the accepted receipt",
        requestBody: {
          required: true,
          content: { "application/json": { schema: okObject } },
        },
        responses: {
          "200": {
            description: "receipt-bound exact absence or ownership restoration verification",
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
    "/v1/channels/{name}/merge": {
      post: {
        operationId: "mergeChannel",
        summary: "Plan or apply an atomic merge of a source channel into this destination channel, preserving message ids",
        description:
          "With dry_run=true (default), returns a non-mutating plan and revision with every collision refused. " +
          "With dry_run=false, expected_revision and idempotency_key are required; the server locks both channel " +
          "rows, rewrites messages/memberships/subscriptions/mentions/tasks/graph edges in place (ids and uuids " +
          "never change), optionally archives and aliases the source, and appends an immutable receipt.",
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            additionalProperties: false,
            required: ["source_channel"],
            properties: {
              source_channel: { type: "string" },
              dry_run: { type: "boolean" },
              archive_source: { type: "boolean" },
              expected_revision: { type: "string" },
              idempotency_key: { type: "string" },
            },
          } } },
        },
        responses: {
          "200": { description: "dry-run plan or idempotent replay", content: { "application/json": { schema: okObject } } },
          "201": { description: "immutable merge receipt", content: { "application/json": { schema: okObject } } },
          "404": { description: "source or destination channel not found", content: { "application/json": { schema: errorObject } } },
          "409": { description: "stale revision, ambiguous destination, or inconsistent idempotency key", content: { "application/json": { schema: errorObject } } },
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
    "/v1/agents/reap-stale": {
      post: {
        operationId: "reapStaleSingleTouch",
        description: "Flag — and only with apply:true, remove — registrations created once and never seen again whose last heartbeat is older than the retention window.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            properties: { apply: { type: "boolean" }, older_than_seconds: { type: "number" } },
          } } },
        },
        responses: { "200": { description: "reap result", content: { "application/json": { schema: okObject } } } },
      },
    },
  },
} as const;

export type OpenApiSpec = typeof openapiSpec;
