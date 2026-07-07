/**
 * OpenAPI 3.1 document for the versioned `/v1` cloud API. This is the SINGLE
 * source of truth the typed SDK is generated from (see scripts/generate-sdk.ts)
 * and is served live at `GET /openapi.json` and `GET /v1/openapi.json`.
 */
import { getPackageVersion } from "../lib/package-version.js";

const taskSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    status: { type: "string" },
    priority: { type: "string" },
    project_id: { type: "string", nullable: true },
    assigned_to: { type: "string", nullable: true },
    agent_id: { type: "string", nullable: true },
    tags: { type: "array", items: { type: "string" } },
    version: { type: "number" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

const projectSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    path: { type: "string" },
    description: { type: "string", nullable: true },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

export function buildV1OpenApiDocument(version = getPackageVersion()) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Todos V1 API",
      version,
      description:
        "Versioned cloud API for @hasna/todos (A1 pure-remote). Authenticate with an API key via the `x-api-key` header or `Authorization: Bearer <token>`.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      schemas: {
        Task: taskSchema,
        Project: projectSchema,
        CreateTaskInput: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            status: { type: "string" },
            priority: { type: "string" },
            project_id: { type: "string" },
            assigned_to: { type: "string" },
            agent_id: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
        },
        UpdateTaskInput: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            status: { type: "string" },
            priority: { type: "string" },
            assigned_to: { type: "string" },
            version: { type: "number" },
          },
        },
        CreateProjectInput: {
          type: "object",
          required: ["name", "path"],
          properties: {
            name: { type: "string" },
            path: { type: "string" },
            description: { type: "string" },
            task_prefix: { type: "string" },
          },
        },
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      "/v1/tasks": {
        get: {
          operationId: "listTasks",
          summary: "List tasks",
          parameters: [
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "project_id", in: "query", schema: { type: "string" } },
            { name: "assigned_to", in: "query", schema: { type: "string" } },
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "number" } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      tasks: { type: "array", items: { $ref: "#/components/schemas/Task" } },
                      count: { type: "number" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "createTask",
          summary: "Create a task",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateTaskInput" } } },
          },
          responses: {
            "201": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { task: { $ref: "#/components/schemas/Task" } } },
                },
              },
            },
          },
        },
      },
      "/v1/tasks/{id}": {
        get: {
          operationId: "getTask",
          summary: "Get a task by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { task: { $ref: "#/components/schemas/Task" } } },
                },
              },
            },
          },
        },
        patch: {
          operationId: "updateTask",
          summary: "Update a task",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateTaskInput" } } },
          },
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { task: { $ref: "#/components/schemas/Task" } } },
                },
              },
            },
          },
        },
        delete: {
          operationId: "deleteTask",
          summary: "Delete a task",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { deleted: { type: "boolean" }, id: { type: "string" } } },
                },
              },
            },
          },
        },
      },
      "/v1/tasks/{id}/start": {
        post: {
          operationId: "startTask",
          summary: "Start a task",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { task: { $ref: "#/components/schemas/Task" } } } } } } },
        },
      },
      "/v1/tasks/{id}/complete": {
        post: {
          operationId: "completeTask",
          summary: "Complete a task",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { task: { $ref: "#/components/schemas/Task" } } } } } } },
        },
      },
      "/v1/projects": {
        get: {
          operationId: "listProjects",
          summary: "List projects",
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      projects: { type: "array", items: { $ref: "#/components/schemas/Project" } },
                      count: { type: "number" },
                    },
                  },
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
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateProjectInput" } } },
          },
          responses: { "201": { content: { "application/json": { schema: { type: "object", properties: { project: { $ref: "#/components/schemas/Project" } } } } } } },
        },
      },
      "/v1/projects/{id}": {
        get: {
          operationId: "getProject",
          summary: "Get a project by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { project: { $ref: "#/components/schemas/Project" } } } } } } },
        },
      },
      "/v1/stats": {
        get: {
          operationId: "getStats",
          summary: "Aggregate counts",
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { tasks: { type: "number" }, projects: { type: "number" } } } } } } },
        },
      },
      "/v1/import": {
        post: {
          operationId: "importSnapshot",
          summary: "Bulk-ingest a full or partial snapshot (idempotent upsert by id)",
          description:
            "Upserts every record carried in the body by primary key. All record arrays are optional and default to []; a caller may backfill a single object type (e.g. just tasks) or a complete snapshot. Re-posting the same rows never duplicates. Requires the todos:write scope.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    exportedAt: { type: "string" },
                    source: { type: "string" },
                    tasks: { type: "array", items: { $ref: "#/components/schemas/Task" } },
                    projects: { type: "array", items: { $ref: "#/components/schemas/Project" } },
                    projectMachinePaths: { type: "array", items: { type: "object" } },
                    plans: { type: "array", items: { type: "object" } },
                    agents: { type: "array", items: { type: "object" } },
                    taskLists: { type: "array", items: { type: "object" } },
                    templates: { type: "array", items: { type: "object" } },
                    auditHistory: { type: "array", items: { type: "object" } },
                    tombstones: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      received: { type: "number" },
                      result: {
                        type: "object",
                        properties: {
                          inserted: { type: "number" },
                          updated: { type: "number" },
                          deleted: { type: "number" },
                          skipped: { type: "number" },
                          errors: { type: "array", items: { type: "string" } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
