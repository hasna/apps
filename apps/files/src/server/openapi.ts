/**
 * OpenAPI 3 description of the open-files self-hosted `/v1` HTTP surface.
 *
 * This is the single source of truth the typed SDK is generated from
 * (`bun run build:sdk` -> `@hasna/contracts/sdk`). Keep it in sync with
 * `src/server/v1.ts`.
 */
export const OPENAPI_VERSION = "1.1.0";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const ok = (schema: unknown) => ({ content: { "application/json": { schema } } });
const idParam = (name: string) => ({ name, in: "path" as const, required: true, schema: { type: "string" } });
const assetId = { type: "string", pattern: "^asset_[a-f0-9]{16}$" } as const;
const intentId = { type: "string", pattern: "^upl_[A-Za-z0-9_-]{12}$" } as const;
const safeTimestamp = {
  type: "string",
  pattern: "^\\d{4}-\\d{2}-\\d{2}(?:T| )\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}(?::?\\d{2})?)?$",
} as const;

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "FilesClient",
    version: OPENAPI_VERSION,
    description: "Agent-first file management — index local folders and S3 buckets, tag, search, organize. Self-hosted HTTP API (PURE REMOTE, API-key auth).",
  },
  servers: [{ url: "/v1" }],
  components: {
    securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } },
    schemas: {
      Source: {
        type: "object",
        properties: {
          id: { type: "string" }, name: { type: "string" },
          type: { type: "string", enum: ["local", "s3", "google_drive"] },
          path: { type: "string", nullable: true }, bucket: { type: "string", nullable: true },
          prefix: { type: "string", nullable: true }, region: { type: "string", nullable: true },
          config: { type: "object", additionalProperties: true },
          machine_id: { type: "string" }, enabled: { type: "boolean" },
          file_count: { type: "integer" }, created_at: { type: "string" }, updated_at: { type: "string" },
        },
        required: ["id", "name", "type", "machine_id", "enabled", "file_count", "created_at", "updated_at"],
      },
      CreateSource: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["local", "s3", "google_drive"] },
          name: { type: "string" }, path: { type: "string" }, bucket: { type: "string" },
          prefix: { type: "string" }, region: { type: "string" },
          config: { type: "object", additionalProperties: true }, machine_id: { type: "string" },
        },
      },
      UpdateSource: {
        type: "object",
        properties: {
          name: { type: "string" }, enabled: { type: "boolean" },
          path: { type: "string" }, bucket: { type: "string" },
          prefix: { type: "string" }, region: { type: "string" },
          config: { type: "object", additionalProperties: true },
        },
      },
      File: {
        type: "object",
        properties: {
          id: { type: "string" }, source_id: { type: "string" }, machine_id: { type: "string" },
          path: { type: "string" }, name: { type: "string" }, ext: { type: "string" },
          size: { type: "integer" }, mime: { type: "string" }, hash: { type: "string", nullable: true },
          status: { type: "string", enum: ["active", "deleted", "moved"] },
          indexed_at: { type: "string" }, created_at: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["id", "source_id", "machine_id", "path", "name", "ext", "size", "mime", "status", "tags"],
      },
      Tag: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, color: { type: "string" }, created_at: { type: "string" } }, required: ["id", "name", "color"] },
      Collection: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, created_at: { type: "string" }, updated_at: { type: "string" } }, required: ["id", "name", "description"] },
      Project: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, status: { type: "string" }, created_at: { type: "string" }, updated_at: { type: "string" } }, required: ["id", "name", "description"] },
      Machine: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, hostname: { type: "string" }, platform: { type: "string" }, arch: { type: "string" }, is_current: { type: "boolean" } }, required: ["id", "name"] },
      NameBody: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name"] },
      FileIdBody: { type: "object", properties: { file_id: { type: "string" } }, required: ["file_id"] },
      TagsBody: { type: "object", properties: { tags: { type: "array", items: { type: "string" } } }, required: ["tags"] },
      Ok: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      Stats: { type: "object", properties: { total_files: { type: "integer" }, total_size: { type: "integer" }, by_ext: { type: "array", items: { type: "object", additionalProperties: true } }, by_source: { type: "array", items: { type: "object", additionalProperties: true } } }, required: ["total_files", "total_size"] },
      CreateEvidenceUpload: {
        type: "object",
        additionalProperties: false,
        properties: {
          org_id: { type: "string" }, company_id: { type: "string" },
          app: { type: "string" }, kind: { type: "string" }, original_name: { type: "string" },
          content_type: { type: "string" }, size: { type: "integer", minimum: 0 },
          checksum: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
          checksum_algorithm: { type: "string", enum: ["sha256"] },
          classification: { type: "string" }, retention_until: { type: "string" },
          retention_policy: { type: "string" }, storage_class: { type: "string" },
          legal_hold: { type: "boolean" }, immutable: { type: "boolean" },
          metadata: { type: "object", additionalProperties: true },
          expires_in_seconds: { type: "integer", minimum: 1 },
        },
        required: ["org_id", "app", "kind", "original_name", "size", "checksum"],
      },
      FileAsset: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: assetId, org_id: { type: "string" }, company_id: { type: "string" },
          app: { type: "string" }, kind: { type: "string" }, classification: { type: "string" },
          original_name: { type: "string" }, content_type: { type: "string" },
          size: { type: "integer", minimum: 0 }, checksum: { type: "string" },
          checksum_algorithm: { type: "string" },
          storage_provider: { type: "string", enum: ["s3", "local"] },
          bucket: { type: "string" }, region: { type: "string" }, object_key: { type: "string" },
          quarantine_key: { type: "string" },
          status: { type: "string", enum: ["pending_upload", "uploaded", "verified", "archived", "deleted"] },
          scan_status: { type: "string", enum: ["pending", "clean", "skipped", "suspicious", "blocked"] },
          retention_until: { type: "string" }, retention_policy: { type: "string" },
          storage_class: { type: "string" }, legal_hold: { type: "boolean" }, immutable: { type: "boolean" },
          metadata: { type: "object", additionalProperties: true },
          created_at: safeTimestamp, updated_at: safeTimestamp, verified_at: safeTimestamp,
        },
        required: [
          "id", "org_id", "app", "kind", "classification", "original_name", "content_type",
          "size", "checksum", "checksum_algorithm", "storage_provider", "object_key", "status",
          "scan_status", "legal_hold", "immutable", "metadata", "created_at", "updated_at",
        ],
      },
      FileUploadIntent: {
        type: "object",
        additionalProperties: false,
        "x-sensitive": true,
        properties: {
          id: intentId, asset_id: assetId, method: { type: "string", enum: ["PUT"] },
          upload_url: {
            type: "string", format: "password", readOnly: true, "x-sensitive": true,
            description: "One-use byte transport capability. Never log, persist, or return from ordinary CLI/MCP output.",
          },
          expires_at: safeTimestamp,
          status: { type: "string", enum: ["pending", "completed", "expired", "cancelled"] },
          expected_checksum: { type: "string" }, expected_checksum_algorithm: { type: "string" },
          expected_size: { type: "integer", minimum: 0 },
          required_headers: {
            type: "object", additionalProperties: { type: "string" }, readOnly: true, "x-sensitive": true,
            description: "Ephemeral allowlisted transport headers. Never persist or log values.",
          },
          metadata: { type: "object", additionalProperties: true },
          created_at: safeTimestamp, completed_at: safeTimestamp,
        },
        required: [
          "id", "asset_id", "method", "upload_url", "expires_at", "status", "expected_checksum",
          "expected_checksum_algorithm", "expected_size", "required_headers", "metadata", "created_at",
        ],
      },
      EvidenceUploadResult: {
        type: "object",
        additionalProperties: false,
        "x-sensitive": true,
        properties: { asset: ref("FileAsset"), intent: ref("FileUploadIntent") },
        required: ["asset", "intent"],
      },
      EvidenceUploadReceiptAsset: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: assetId, status: { type: "string" }, scan_status: { type: "string" },
          checksum: { type: "string" }, checksum_algorithm: { type: "string" },
          size: { type: "integer" }, storage_provider: { type: "string" }, verified_at: safeTimestamp,
        },
        required: ["id", "status", "scan_status", "checksum", "checksum_algorithm", "size", "storage_provider"],
      },
      EvidenceUploadReceiptIntent: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: intentId, asset_id: assetId, expires_at: safeTimestamp,
          status: { type: "string" }, expected_checksum: { type: "string" },
          expected_checksum_algorithm: { type: "string" }, expected_size: { type: "integer" },
          created_at: safeTimestamp, completed_at: safeTimestamp,
        },
        required: [
          "id", "asset_id", "expires_at", "status", "expected_checksum",
          "expected_checksum_algorithm", "expected_size", "created_at",
        ],
      },
      EvidenceUploadReceipt: {
        type: "object",
        additionalProperties: false,
        properties: {
          asset: ref("EvidenceUploadReceiptAsset"),
          intent: ref("EvidenceUploadReceiptIntent"),
        },
        required: ["asset", "intent"],
      },
    },
  },
  security: [{ apiKey: [] }],
  paths: {
    "/sources": {
      get: {
        operationId: "listSources", summary: "List sources",
        parameters: [{ name: "machine_id", in: "query", schema: { type: "string" } }],
        responses: { "200": ok({ type: "array", items: ref("Source") }) },
      },
      post: {
        operationId: "createSource", summary: "Create a source",
        requestBody: { required: true, content: { "application/json": { schema: ref("CreateSource") } } },
        responses: { "201": ok(ref("Source")) },
      },
    },
    "/sources/{id}": {
      get: { operationId: "getSource", summary: "Get a source", parameters: [idParam("id")], responses: { "200": ok(ref("Source")) } },
      patch: { operationId: "updateSource", summary: "Update a source (rename/enable/disable/reconfigure)", parameters: [idParam("id")], requestBody: { required: true, content: { "application/json": { schema: ref("UpdateSource") } } }, responses: { "200": ok(ref("Source")) } },
      delete: { operationId: "deleteSource", summary: "Delete a source", parameters: [idParam("id")], responses: { "200": ok(ref("Ok")) } },
    },
    "/files": {
      get: {
        operationId: "listFiles", summary: "List / search files",
        parameters: [
          { name: "source_id", in: "query", schema: { type: "string" } },
          { name: "ext", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": ok({ type: "array", items: ref("File") }) },
      },
    },
    "/files/{id}": { get: { operationId: "getFile", summary: "Get a file", parameters: [idParam("id")], responses: { "200": ok(ref("File")) } } },
    "/files/{id}/tags": {
      post: { operationId: "addFileTags", summary: "Add tags to a file", parameters: [idParam("id")], requestBody: { required: true, content: { "application/json": { schema: ref("TagsBody") } } }, responses: { "200": ok(ref("Ok")) } },
      delete: { operationId: "removeFileTags", summary: "Remove tags from a file", parameters: [idParam("id")], requestBody: { required: true, content: { "application/json": { schema: ref("TagsBody") } } }, responses: { "200": ok(ref("Ok")) } },
    },
    "/tags": { get: { operationId: "listTags", summary: "List tags", responses: { "200": ok({ type: "array", items: ref("Tag") }) } } },
    "/collections": {
      get: { operationId: "listCollections", summary: "List collections", responses: { "200": ok({ type: "array", items: ref("Collection") }) } },
      post: { operationId: "createCollection", summary: "Create a collection", requestBody: { required: true, content: { "application/json": { schema: ref("NameBody") } } }, responses: { "201": ok(ref("Collection")) } },
    },
    "/collections/{id}/files": { post: { operationId: "addToCollection", summary: "Add a file to a collection", parameters: [idParam("id")], requestBody: { required: true, content: { "application/json": { schema: ref("FileIdBody") } } }, responses: { "200": ok(ref("Ok")) } } },
    "/collections/{id}/files/{fileId}": { delete: { operationId: "removeFromCollection", summary: "Remove a file from a collection", parameters: [idParam("id"), idParam("fileId")], responses: { "200": ok(ref("Ok")) } } },
    "/projects": {
      get: { operationId: "listProjects", summary: "List projects", responses: { "200": ok({ type: "array", items: ref("Project") }) } },
      post: { operationId: "createProject", summary: "Create a project", requestBody: { required: true, content: { "application/json": { schema: ref("NameBody") } } }, responses: { "201": ok(ref("Project")) } },
    },
    "/projects/{id}/files": { post: { operationId: "addToProject", summary: "Add a file to a project", parameters: [idParam("id")], requestBody: { required: true, content: { "application/json": { schema: ref("FileIdBody") } } }, responses: { "200": ok(ref("Ok")) } } },
    "/projects/{id}/files/{fileId}": { delete: { operationId: "removeFromProject", summary: "Remove a file from a project", parameters: [idParam("id"), idParam("fileId")], responses: { "200": ok(ref("Ok")) } } },
    "/machines": { get: { operationId: "listMachines", summary: "List machines", responses: { "200": ok({ type: "array", items: ref("Machine") }) } } },
    "/stats": { get: { operationId: "getStats", summary: "Aggregate file stats", responses: { "200": ok(ref("Stats")) } } },
    "/evidence/upload-intents": {
      post: {
        operationId: "createEvidenceUploadIntent",
        summary: "Create an explicit sensitive evidence byte-upload intent",
        description: "Low-level transport API. The response contains a one-use capability and must never be logged or persisted.",
        requestBody: { required: true, content: { "application/json": { schema: ref("CreateEvidenceUpload") } } },
        responses: { "201": ok(ref("EvidenceUploadResult")) },
      },
    },
    "/evidence/upload-intents/{intentId}/complete": {
      post: {
        operationId: "completeEvidenceUpload",
        summary: "Verify and complete an evidence byte upload",
        parameters: [idParam("intentId")],
        responses: { "200": ok(ref("FileAsset")) },
      },
    },
  },
} as const;
