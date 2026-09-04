/**
 * OpenAPI 3.1 document for the @hasna/logs cloud serve `/v1` surface.
 *
 * This is the single source of truth for the versioned HTTP API and for the
 * generated typed SDK (see `scripts/generate-sdk-api.ts`). Keep the operations
 * here in lockstep with `routes.ts`.
 */

export interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: { url: string; description?: string }[];
  security?: Record<string, unknown>[];
  components: Record<string, unknown>;
  paths: Record<string, unknown>;
}

const jsonError = {
  type: "object",
  properties: { error: { type: "string" }, reason: { type: "string" } },
  required: ["error"],
} as const;

export function buildOpenApiDocument(version: string): OpenApiDoc {
  return {
    openapi: "3.1.0",
    info: {
      title: "Logs",
      version,
      description:
        "Cloud API for @hasna/logs — the shared, S3-backed log sink. All /v1 " +
        "routes require a Hasna API key (x-api-key or Authorization: Bearer).",
    },
    servers: [
      {
        url: "https://your-deployment.example",
        description:
          "Replace with your @hasna/logs deployment's base URL.",
      },
    ],
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      schemas: {
        Project: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            github_repo: { type: "string", nullable: true },
            base_url: { type: "string", nullable: true },
            description: { type: "string", nullable: true },
            created_at: { type: "string" },
          },
          required: ["id", "name", "created_at"],
        },
        CreateProject: {
          type: "object",
          properties: {
            name: { type: "string" },
            github_repo: { type: "string", nullable: true },
            base_url: { type: "string", nullable: true },
            description: { type: "string", nullable: true },
          },
          required: ["name"],
        },
        LogRecord: {
          type: "object",
          properties: {
            id: { type: "string" },
            timestamp: { type: "string" },
            project_id: { type: "string", nullable: true },
            page_id: { type: "string", nullable: true },
            level: {
              type: "string",
              enum: ["debug", "info", "warn", "error", "fatal"],
            },
            source: { type: "string" },
            service: { type: "string", nullable: true },
            message: { type: "string" },
            trace_id: { type: "string", nullable: true },
            session_id: { type: "string", nullable: true },
            agent: { type: "string", nullable: true },
            url: { type: "string", nullable: true },
            stack_trace: { type: "string", nullable: true },
            metadata: {
              type: "object",
              nullable: true,
              additionalProperties: true,
            },
            source_event_id: { type: "string", nullable: true },
            machine_id: { type: "string", nullable: true },
            repo_id: { type: "string", nullable: true },
            app_id: { type: "string", nullable: true },
            process_id: { type: "string", nullable: true },
            run_id: { type: "string", nullable: true },
            span_id: { type: "string", nullable: true },
            parent_span_id: { type: "string", nullable: true },
            release_id: { type: "string", nullable: true },
            environment: { type: "string", nullable: true },
            privacy: { type: "string", nullable: true },
          },
          required: ["id", "timestamp", "level", "source", "message"],
        },
        CreateLog: {
          type: "object",
          properties: {
            id: { type: "string" },
            level: {
              type: "string",
              enum: ["debug", "info", "warn", "error", "fatal"],
            },
            message: { type: "string" },
            project_id: { type: "string", nullable: true },
            page_id: { type: "string", nullable: true },
            source: { type: "string", nullable: true },
            service: { type: "string", nullable: true },
            trace_id: { type: "string", nullable: true },
            session_id: { type: "string", nullable: true },
            agent: { type: "string", nullable: true },
            url: { type: "string", nullable: true },
            stack_trace: { type: "string", nullable: true },
            metadata: {
              type: "object",
              nullable: true,
              additionalProperties: true,
            },
            timestamp: { type: "string", nullable: true },
            source_event_id: { type: "string", nullable: true },
            machine_id: { type: "string", nullable: true },
            repo_id: { type: "string", nullable: true },
            app_id: { type: "string", nullable: true },
            process_id: { type: "string", nullable: true },
            run_id: { type: "string", nullable: true },
            span_id: { type: "string", nullable: true },
            parent_span_id: { type: "string", nullable: true },
            release_id: { type: "string", nullable: true },
            environment: { type: "string", nullable: true },
            privacy: { type: "string", nullable: true },
          },
          required: ["level", "message"],
        },
        ProjectList: {
          type: "object",
          properties: {
            projects: {
              type: "array",
              items: { $ref: "#/components/schemas/Project" },
            },
          },
          required: ["projects"],
        },
        LogList: {
          type: "object",
          properties: {
            logs: {
              type: "array",
              items: { $ref: "#/components/schemas/LogRecord" },
            },
          },
          required: ["logs"],
        },
        DeleteResult: {
          type: "object",
          properties: { deleted: { type: "boolean" }, id: { type: "string" } },
          required: ["deleted", "id"],
        },
        ErrorResponse: jsonError,
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      "/v1/projects": {
        get: {
          operationId: "listProjects",
          summary: "List projects",
          responses: {
            "200": {
              description: "Projects",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ProjectList" },
                },
              },
            },
          },
        },
        post: {
          operationId: "createProject",
          summary: "Create a project",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateProject" },
              },
            },
          },
          responses: {
            "201": {
              description: "Created project",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Project" },
                },
              },
            },
          },
        },
      },
      "/v1/projects/{id}": {
        get: {
          operationId: "getProject",
          summary: "Get a project by id",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Project",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Project" },
                },
              },
            },
            "404": {
              description: "Not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/logs": {
        get: {
          operationId: "listLogs",
          summary: "Search logs",
          parameters: [
            {
              name: "project_id",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
            {
              name: "level",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
            {
              name: "service",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
            {
              name: "trace_id",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
            {
              name: "q",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer" },
            },
          ],
          responses: {
            "200": {
              description: "Matching logs",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/LogList" },
                },
              },
            },
          },
        },
        post: {
          operationId: "ingestLog",
          summary: "Ingest a log entry",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateLog" },
              },
            },
          },
          responses: {
            "201": {
              description: "Created log",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/LogRecord" },
                },
              },
            },
          },
        },
      },
      "/v1/logs/{id}": {
        get: {
          operationId: "getLog",
          summary: "Get a log entry by id",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Log entry",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/LogRecord" },
                },
              },
            },
            "404": {
              description: "Not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
        delete: {
          operationId: "deleteLog",
          summary: "Delete a log entry by id",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Delete result",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/DeleteResult" },
                },
              },
            },
          },
        },
      },
    },
  };
}
