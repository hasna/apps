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
    task_list_id: { type: "string", nullable: true },
    task_prefix: { type: "string", nullable: true },
    task_counter: { type: "number" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

const taskListSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    project_id: { type: "string", nullable: true },
    slug: { type: "string" },
    name: { type: "string" },
    description: { type: "string", nullable: true },
    metadata: { type: "object", additionalProperties: true },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

const taskCommentSchema = {
  type: "object",
  required: ["id", "task_id", "agent_id", "session_id", "content", "type", "progress_pct", "created_at"],
  properties: {
    id: { type: "string" },
    task_id: { type: "string" },
    agent_id: { type: "string", nullable: true },
    session_id: { type: "string", nullable: true },
    content: { type: "string" },
    type: { type: "string", enum: ["comment", "progress", "note"] },
    progress_pct: { type: "number", nullable: true },
    created_at: { type: "string", format: "date-time" },
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
        TaskList: taskListSchema,
        TaskComment: taskCommentSchema,
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
          additionalProperties: false,
          required: ["name", "path"],
          properties: {
            name: { type: "string", minLength: 1, pattern: ".*[A-Za-z0-9].*" },
            path: { type: "string", minLength: 1 },
            description: { type: "string" },
            task_list_id: { type: "string", minLength: 1, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
            task_prefix: { type: "string", minLength: 1 },
          },
        },
        UpdateProjectInput: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 1 },
            path: { type: "string", minLength: 1 },
            description: { type: "string", nullable: true },
          },
        },
        RenameProjectInput: {
          type: "object",
          additionalProperties: false,
          required: ["new_slug"],
          properties: {
            new_slug: { type: "string", minLength: 1, pattern: ".*[A-Za-z0-9].*" },
            name: { type: "string", minLength: 1 },
          },
        },
        ErrorResponse: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string" },
            code: { type: "string" },
            conflict: { type: "boolean" },
          },
        },
        CreateTaskListInput: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, pattern: ".*[A-Za-z0-9].*" },
            slug: { type: "string", minLength: 1, pattern: ".*[A-Za-z0-9].*" },
            project_id: { type: "string" },
            description: { type: "string" },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        UpdateTaskListInput: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            slug: { type: "string", minLength: 1, pattern: ".*[A-Za-z0-9].*" },
            name: { type: "string" },
            description: { type: "string" },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        CreateTaskCommentInput: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string", minLength: 1 },
            agent_id: { type: "string" },
            session_id: { type: "string" },
            type: { type: "string", enum: ["comment", "progress", "note"] },
            progress_pct: { type: "number" },
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
      "/v1/tasks/{id}/comments": {
        get: {
          operationId: "listTaskComments",
          summary: "List a bounded page of task comments",
          description:
            "Returns the newest page in oldest-to-newest display order. Use next_cursor to request older pages; count is the page size, not a total. Pagination-aware clients must send limit during the mixed-version rollout.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", required: true, schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
            { name: "cursor", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["comments", "count", "has_more", "next_cursor"],
                    properties: {
                      comments: { type: "array", maxItems: 500, items: { $ref: "#/components/schemas/TaskComment" } },
                      count: { type: "integer", minimum: 0, maximum: 500 },
                      has_more: { type: "boolean" },
                      next_cursor: { type: "string", nullable: true },
                    },
                  },
                },
              },
            },
            "426": {
              description:
                "Upgrade required: a predecessor client omitted limit and the complete legacy history exceeds 500 comments, or the configured storage adapter lacks cursor pagination support.",
            },
          },
        },
        post: {
          operationId: "createTaskComment",
          summary: "Create a task comment",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateTaskCommentInput" } } },
          },
          responses: {
            "201": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["comment"],
                    properties: { comment: { $ref: "#/components/schemas/TaskComment" } },
                  },
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
          responses: {
            "201": { content: { "application/json": { schema: { type: "object", properties: { project: { $ref: "#/components/schemas/Project" } } } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/projects/{id}": {
        get: {
          operationId: "getProject",
          summary: "Get a project by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { project: { $ref: "#/components/schemas/Project" } } } } } } },
        },
        patch: {
          operationId: "updateProject",
          summary: "Update a project",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateProjectInput" } } },
          },
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { project: { $ref: "#/components/schemas/Project" } } } } } } },
        },
        delete: {
          operationId: "deleteProject",
          summary: "Delete a project",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { deleted: { type: "boolean" }, id: { type: "string" } } } } } } },
        },
      },
      "/v1/projects/{id}/rename": {
        post: {
          operationId: "renameProject",
          summary: "Atomically rename a project and its canonical task list",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/RenameProjectInput" } } },
          },
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: { project: { $ref: "#/components/schemas/Project" }, task_lists_updated: { type: "number" } } } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/task-lists": {
        get: {
          operationId: "listTaskLists",
          summary: "List task lists",
          parameters: [{ name: "project_id", in: "query", schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { task_lists: { type: "array", items: { $ref: "#/components/schemas/TaskList" } }, count: { type: "number" } } } } } } },
        },
        post: {
          operationId: "createTaskList",
          summary: "Create a task list",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateTaskListInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { type: "object", properties: { task_list: { $ref: "#/components/schemas/TaskList" } } } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/task-lists/{id}": {
        get: {
          operationId: "getTaskList",
          summary: "Get a task list by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: { task_list: { $ref: "#/components/schemas/TaskList" } } } } } },
          },
        },
        patch: {
          operationId: "updateTaskList",
          summary: "Update a task list",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateTaskListInput" } } },
          },
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: { task_list: { $ref: "#/components/schemas/TaskList" } } } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
        delete: {
          operationId: "deleteTaskList",
          summary: "Delete a task list",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { deleted: { type: "boolean" }, id: { type: "string" } } } } } } },
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
