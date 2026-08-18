/**
 * OpenAPI 3 description of the open-files self-hosted `/v1` HTTP surface.
 *
 * This is the single source of truth the typed SDK is generated from
 * (`bun run build:sdk` -> `@hasna/contracts/sdk`). Keep it in sync with
 * `src/server/v1.ts`.
 */
export const OPENAPI_VERSION = "1.0.0";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const ok = (schema: unknown) => ({ content: { "application/json": { schema } } });
const idParam = (name: string) => ({ name, in: "path" as const, required: true, schema: { type: "string" } });

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
          rank: { type: "number", description: "Search relevance when returned from a ranked search" },
          search_match_sources: { type: "array", items: { type: "string", enum: ["metadata", "content"] } },
          search_document_kinds: { type: "array", items: { type: "string" } },
          search_document_count: { type: "integer" },
        },
        required: ["id", "source_id", "machine_id", "path", "name", "ext", "size", "mime", "status", "tags"],
      },
      SearchDocument: {
        type: "object",
        properties: {
          id: { type: "string" },
          file_id: { type: "string" },
          revision_id: { type: "string", nullable: true },
          source_ref: { type: "string" },
          kind: { type: "string" },
          extractor: { type: "string" },
          content_hash: { type: "string" },
          searchable_text: { type: "string" },
          metadata: { type: "object", additionalProperties: true },
          status: { type: "string", enum: ["ready", "partial", "unsupported", "error", "stale"] },
          private: { type: "boolean" },
          created_at: { type: "string" },
          updated_at: { type: "string" },
        },
        required: ["id", "file_id", "source_ref", "kind", "extractor", "content_hash", "searchable_text", "metadata", "status", "private", "created_at", "updated_at"],
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
      ExtractedText: {
        type: "object",
        additionalProperties: true,
        properties: {
          source_ref: { type: "string" },
          file_id: { type: "string" },
          revision_id: { type: "string" },
          status: { type: "string" },
          mime: { type: "string" },
          bytes_read: { type: "integer" },
          total_size: { type: "integer" },
          truncated: { type: "boolean" },
          redacted: { type: "boolean" },
          segments: { type: "array", items: { type: "object", additionalProperties: true } },
          metadata: { type: "object", additionalProperties: true },
        },
        required: ["source_ref", "status", "mime", "bytes_read", "truncated", "redacted", "segments", "metadata"],
      },
      FileAsset: {
        type: "object",
        properties: {
          id: { type: "string" },
          org_id: { type: "string" },
          company_id: { type: "string" },
          app: { type: "string" },
          kind: { type: "string" },
          classification: { type: "string" },
          version: { type: "integer" },
          canonical_ref: { type: "string" },
          provenance_type: { type: "string" },
          provenance_id: { type: "string" },
          provenance_ref: { type: "string" },
          external_references: { type: "array", items: { type: "string" } },
          idempotency_key: { type: "string" },
          original_name: { type: "string" },
          content_type: { type: "string" },
          size: { type: "integer" },
          checksum: { type: "string" },
          checksum_algorithm: { type: "string", enum: ["sha256"] },
          storage_provider: { type: "string", enum: ["s3", "local"] },
          bucket: { type: "string" },
          region: { type: "string" },
          object_key: { type: "string" },
          quarantine_key: { type: "string" },
          status: { type: "string", enum: ["pending_upload", "uploaded", "verified", "archived", "deleted"] },
          scan_status: { type: "string", enum: ["pending", "clean", "skipped", "suspicious", "blocked"] },
          retention_until: { type: "string" },
          retention_policy: { type: "string" },
          storage_class: { type: "string" },
          legal_hold: { type: "boolean" },
          immutable: { type: "boolean" },
          metadata: { type: "object", additionalProperties: true },
          created_at: { type: "string" },
          updated_at: { type: "string" },
          verified_at: { type: "string" },
        },
        required: [
          "id", "org_id", "app", "kind", "classification", "version", "canonical_ref",
          "provenance_type", "provenance_id", "external_references", "original_name",
          "content_type", "size", "checksum", "checksum_algorithm", "storage_provider",
          "object_key", "status", "scan_status", "legal_hold", "immutable", "metadata",
          "created_at", "updated_at",
        ],
      },
      FileUploadIntent: {
        type: "object",
        properties: {
          id: { type: "string" },
          asset_id: { type: "string" },
          method: { type: "string", enum: ["PUT"] },
          upload_url: { type: "string" },
          expires_at: { type: "string" },
          status: { type: "string", enum: ["pending", "completed", "expired", "cancelled"] },
          expected_checksum: { type: "string" },
          expected_checksum_algorithm: { type: "string" },
          expected_size: { type: "integer" },
          required_headers: { type: "object", additionalProperties: { type: "string" } },
          metadata: { type: "object", additionalProperties: true },
          created_at: { type: "string" },
          completed_at: { type: "string" },
        },
        required: [
          "id", "asset_id", "method", "expires_at", "status", "expected_checksum",
          "expected_checksum_algorithm", "expected_size", "required_headers", "metadata",
          "created_at",
        ],
      },
      EvidenceUploadResult: {
        type: "object",
        properties: {
          asset: ref("FileAsset"),
          intent: ref("FileUploadIntent"),
          replayed: { type: "boolean" },
        },
        required: ["asset", "intent", "replayed"],
      },
      CreateEvidenceUpload: {
        type: "object",
        properties: {
          org_id: { type: "string", description: "Must match the authenticated tenant when supplied." },
          company_id: { type: "string" },
          app: { type: "string" },
          kind: { type: "string" },
          original_name: { type: "string" },
          content_type: { type: "string" },
          size: { type: "integer" },
          checksum: { type: "string" },
          checksum_algorithm: { type: "string", enum: ["sha256"] },
          classification: { type: "string" },
          version: { type: "integer" },
          provenance_type: { type: "string" },
          provenance_id: { type: "string" },
          provenance_ref: { type: "string" },
          external_references: { type: "array", items: { type: "string" } },
          idempotency_key: { type: "string" },
          retention_until: { type: "string" },
          retention_policy: { type: "string" },
          storage_class: { type: "string" },
          legal_hold: { type: "boolean" },
          immutable: { type: "boolean" },
          metadata: { type: "object", additionalProperties: true },
          expires_in_seconds: { type: "integer" },
          include_upload_url: { type: "boolean" },
        },
        required: ["app", "kind", "original_name", "size", "checksum"],
      },
      FileLink: {
        type: "object",
        properties: {
          id: { type: "string" },
          asset_id: { type: "string" },
          org_id: { type: "string" },
          company_id: { type: "string" },
          app: { type: "string" },
          source_type: { type: "string" },
          source_id: { type: "string" },
          kind: { type: "string" },
          metadata: { type: "object", additionalProperties: true },
          created_at: { type: "string" },
        },
        required: ["id", "asset_id", "org_id", "app", "source_type", "source_id", "kind", "metadata", "created_at"],
      },
      CreateEvidenceLink: {
        type: "object",
        properties: {
          org_id: { type: "string", description: "Must match the authenticated tenant when supplied." },
          company_id: { type: "string" },
          app: { type: "string" },
          source_type: { type: "string" },
          source_id: { type: "string" },
          kind: { type: "string" },
          metadata: { type: "object", additionalProperties: true },
        },
        required: ["app", "source_type", "source_id", "kind"],
      },
      FileAccessEvent: {
        type: "object",
        properties: {
          id: { type: "string" },
          asset_id: { type: "string" },
          org_id: { type: "string" },
          company_id: { type: "string" },
          app: { type: "string" },
          actor_id: { type: "string" },
          action: { type: "string", enum: ["create_upload", "complete_upload", "link", "sign_download", "download", "verify", "archive", "delete"] },
          purpose: { type: "string" },
          metadata: { type: "object", additionalProperties: true },
          created_at: { type: "string" },
        },
        required: ["id", "asset_id", "org_id", "action", "metadata", "created_at"],
      },
      SignEvidenceDownload: {
        type: "object",
        properties: {
          actor_id: { type: "string" },
          purpose: { type: "string" },
          expires_in_seconds: { type: "integer" },
        },
      },
      EvidenceDownloadGrant: {
        type: "object",
        properties: {
          asset: ref("FileAsset"),
          url: { type: "string" },
          expires_at: { type: "string" },
        },
        required: ["asset", "url", "expires_at"],
      },
      EvidenceVerifyResult: {
        type: "object",
        properties: {
          asset: ref("FileAsset"),
          ok: { type: "boolean" },
          diagnostics: { type: "array", items: { type: "string" } },
        },
        required: ["asset", "ok", "diagnostics"],
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
        operationId: "listFiles", summary: "List / search files (ranked full-text search over metadata + derived content)",
        parameters: [
          { name: "source_id", in: "query", schema: { type: "string" } },
          { name: "machine_id", in: "query", schema: { type: "string" } },
          { name: "project_id", in: "query", schema: { type: "string" } },
          { name: "collection_id", in: "query", schema: { type: "string" } },
          { name: "tag", in: "query", schema: { type: "string" } },
          { name: "ext", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string", description: "Search term; matched against metadata and (per search_scope) derived content" } },
          { name: "search_scope", in: "query", schema: { type: "string", enum: ["all", "metadata", "content"] } },
          { name: "after", in: "query", schema: { type: "string", description: "ISO date; modified (or indexed) on or after" } },
          { name: "before", in: "query", schema: { type: "string", description: "ISO date; modified (or indexed) on or before" } },
          { name: "min_size", in: "query", schema: { type: "integer", description: "Minimum file size in bytes" } },
          { name: "max_size", in: "query", schema: { type: "integer", description: "Maximum file size in bytes" } },
          { name: "sort", in: "query", schema: { type: "string", enum: ["name", "size", "date"] } },
          { name: "sort_dir", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": ok({ type: "array", items: ref("File") }) },
      },
    },
    "/files/{id}/search-documents": {
      post: {
        operationId: "upsertSearchDocument", summary: "Upsert a derived content search document for a file",
        parameters: [idParam("id")],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  source_ref: { type: "string" },
                  kind: { type: "string" },
                  extractor: { type: "string" },
                  content_hash: { type: "string" },
                  searchable_text: { type: "string" },
                  metadata: { type: "object", additionalProperties: true },
                  status: { type: "string" },
                  private: { type: "boolean" },
                  replace_existing: { type: "boolean" },
                  revision_id: { type: "string" },
                },
                required: ["source_ref", "kind", "searchable_text"],
              },
            },
          },
        },
        responses: { "201": ok(ref("SearchDocument")) },
      },
    },
    "/search-documents": {
      get: {
        operationId: "listSearchDocuments", summary: "List derived search documents without indexed text",
        parameters: [
          { name: "file_id", in: "query", schema: { type: "string" } },
          { name: "kind", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": ok({ type: "array", items: ref("SearchDocument") }) },
      },
    },
    "/search-documents/{id}": {
      delete: {
        operationId: "deleteSearchDocument", summary: "Remove a derived search document and its index entry",
        parameters: [idParam("id")],
        responses: { "200": ok(ref("Ok")) },
      },
    },
    "/files/{id}": { get: { operationId: "getFile", summary: "Get a file", parameters: [idParam("id")], responses: { "200": ok(ref("File")) } } },
    // `/files/{id}/content` is intentionally handled by ApiStore's
    // authenticated raw-response transport rather than this generated JSON
    // client. The current generator parses every response as text/JSON and
    // would expose a binary operation as Promise<void>, silently discarding
    // the downloaded bytes.
    "/files/{id}/extract-text": {
      post: {
        operationId: "extractFileText",
        summary: "Retrieve authorized derived text extraction",
        parameters: [idParam("id")],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  max_bytes: { type: "integer" },
                  max_segment_chars: { type: "integer" },
                  redact_patterns: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: { "200": ok(ref("ExtractedText")) },
      },
    },
    "/files/{id}/tags": {
      post: { operationId: "addFileTags", summary: "Add tags to a file", parameters: [idParam("id")], requestBody: { required: true, content: { "application/json": { schema: ref("TagsBody") } } }, responses: { "200": ok(ref("Ok")) } },
      delete: { operationId: "removeFileTags", summary: "Remove tags from a file", parameters: [idParam("id")], requestBody: { required: true, content: { "application/json": { schema: ref("TagsBody") } } }, responses: { "200": ok(ref("Ok")) } },
    },
    "/evidence/upload-intents": {
      post: {
        operationId: "createEvidenceUploadIntent",
        summary: "Create an immutable evidence asset and upload intent for the authenticated tenant",
        requestBody: { required: true, content: { "application/json": { schema: ref("CreateEvidenceUpload") } } },
        responses: { "201": ok(ref("EvidenceUploadResult")) },
      },
    },
    "/evidence/upload-intents/{id}/complete": {
      post: {
        operationId: "completeEvidenceUpload",
        summary: "Complete and verify an evidence upload owned by the authenticated tenant",
        parameters: [idParam("id")],
        responses: { "200": ok(ref("FileAsset")) },
      },
    },
    "/evidence/assets": {
      get: {
        operationId: "listEvidenceAssets",
        summary: "List evidence assets owned by the authenticated tenant",
        parameters: [
          { name: "org_id", in: "query", schema: { type: "string" }, description: "Must match the authenticated tenant when supplied." },
          { name: "company_id", in: "query", schema: { type: "string" } },
          { name: "app", in: "query", schema: { type: "string" } },
          { name: "kind", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["pending_upload", "uploaded", "verified", "archived", "deleted"] } },
          { name: "checksum", in: "query", schema: { type: "string" } },
          { name: "provenance_type", in: "query", schema: { type: "string" } },
          { name: "provenance_id", in: "query", schema: { type: "string" } },
          { name: "provenance_ref", in: "query", schema: { type: "string" } },
          { name: "version", in: "query", schema: { type: "integer" } },
          { name: "classification", in: "query", schema: { type: "string" } },
          { name: "retention_policy", in: "query", schema: { type: "string" } },
          { name: "external_reference", in: "query", schema: { type: "string" } },
          { name: "idempotency_key", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": ok({ type: "array", items: ref("FileAsset") }) },
      },
    },
    "/evidence/assets/{id}": {
      get: {
        operationId: "getEvidenceAsset",
        summary: "Get an evidence asset owned by the authenticated tenant",
        parameters: [idParam("id")],
        responses: { "200": ok(ref("FileAsset")) },
      },
    },
    "/evidence/assets/{id}/links": {
      get: {
        operationId: "listEvidenceLinks",
        summary: "List links for an evidence asset owned by the authenticated tenant",
        parameters: [idParam("id")],
        responses: { "200": ok({ type: "array", items: ref("FileLink") }) },
      },
      post: {
        operationId: "linkEvidenceAsset",
        summary: "Link an evidence asset owned by the authenticated tenant",
        parameters: [idParam("id")],
        requestBody: { required: true, content: { "application/json": { schema: ref("CreateEvidenceLink") } } },
        responses: { "201": ok(ref("FileLink")) },
      },
    },
    "/evidence/assets/{id}/sign-download": {
      post: {
        operationId: "signEvidenceDownload",
        summary: "Create a private download grant for an evidence asset owned by the authenticated tenant",
        parameters: [idParam("id")],
        requestBody: { required: false, content: { "application/json": { schema: ref("SignEvidenceDownload") } } },
        responses: { "200": ok(ref("EvidenceDownloadGrant")) },
      },
    },
    "/evidence/assets/{id}/verify": {
      post: {
        operationId: "verifyEvidenceAsset",
        summary: "Verify the bytes and checksum of an evidence asset owned by the authenticated tenant",
        parameters: [idParam("id")],
        responses: { "200": ok(ref("EvidenceVerifyResult")) },
      },
    },
    "/evidence/assets/{id}/access-events": {
      get: {
        operationId: "listEvidenceAccessEvents",
        summary: "List access events for an evidence asset owned by the authenticated tenant",
        parameters: [
          idParam("id"),
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": ok({ type: "array", items: ref("FileAccessEvent") }) },
      },
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
  },
} as const;
