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
  },
} as const;
