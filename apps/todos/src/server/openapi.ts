/**
 * OpenAPI 3.1 documents for the versioned `/v1` cloud API.
 *
 * `buildV1OpenApiDocument` is the truthful live Stage-A contract served by the
 * process. `buildFutureV1OpenApiDocument` preserves the disabled positive
 * contract used to generate the future SDK without advertising those outcomes
 * to current callers.
 */
import { getPackageVersion } from "../lib/package-version.js";
import {
  TODOS_STAGE_A_DISPATCH_ORDER,
  TODOS_STAGE_A_ROUTES,
  type TodosStageARoute,
} from "./stage-a-dispatch.js";

const taskSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    status: { type: "string" },
    priority: { type: "string" },
    project_id: { type: "string", nullable: true },
    task_list_id: { type: "string", nullable: true },
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

const planSchema = {
  type: "object",
  required: ["id", "slug", "name", "status", "created_at", "updated_at"],
  properties: {
    id: { type: "string" },
    slug: { type: "string", nullable: true },
    project_id: { type: "string", nullable: true },
    task_list_id: { type: "string", nullable: true },
    agent_id: { type: "string", nullable: true },
    name: { type: "string" },
    description: { type: "string", nullable: true },
    status: { type: "string", enum: ["active", "completed", "archived"] },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
} as const;

export function buildFutureV1OpenApiDocument(version = getPackageVersion()) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Todos V1 API",
      version,
      description:
        "Future-positive contract (not live; disabled in Stage A). When a later trusted-authority stage enables it, authenticate with an API key via the `x-api-key` header or `Authorization: Bearer <token>`.",
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
        Plan: planSchema,
        CreateTaskInput: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            status: { type: "string" },
            priority: { type: "string" },
            project_id: { type: "string" },
            task_list_id: { type: "string", minLength: 1 },
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
            task_list_id: { type: "string", nullable: true, minLength: 1 },
            version: { type: "number" },
          },
        },
        CompleteTaskInput: {
          type: "object",
          additionalProperties: false,
          properties: {
            agent_id: { type: "string", minLength: 1 },
            attachment_ids: { type: "array", items: { type: "string", minLength: 1 } },
            files_changed: { type: "array", items: { type: "string", minLength: 1 } },
            test_results: { type: "string" },
            commit_hash: { type: "string" },
            notes: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
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
        CreatePlanInput: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1 },
            slug: { type: "string", minLength: 1, pattern: ".*[A-Za-z0-9].*" },
            description: { type: "string" },
            project_id: { type: "string", minLength: 1 },
            task_list_id: { type: "string", minLength: 1 },
            agent_id: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["active", "completed", "archived"] },
          },
        },
        UpdatePlanInput: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 1 },
            slug: { type: "string", minLength: 1, pattern: ".*[A-Za-z0-9].*" },
            description: { type: "string" },
            task_list_id: { type: "string", minLength: 1 },
            agent_id: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["active", "completed", "archived"] },
          },
        },
      },
    },
    security: [{ apiKey: [] }],
    "x-stage-a-enabled": false,
    paths: {
      "/v1/tasks": {
        get: {
          operationId: "listTasks",
          summary: "List tasks",
          parameters: [
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "priority", in: "query", schema: { type: "string" } },
            { name: "project_id", in: "query", schema: { type: "string" } },
            { name: "parent_id", in: "query", schema: { type: "string", nullable: true } },
            { name: "include_subtasks", in: "query", schema: { type: "boolean" } },
            { name: "plan_id", in: "query", schema: { type: "string" } },
            { name: "task_list_id", in: "query", schema: { type: "string" } },
            { name: "assigned_to", in: "query", schema: { type: "string" } },
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1 } },
            { name: "offset", in: "query", schema: { type: "integer", minimum: 0 } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["tasks", "count", "total"],
                    properties: {
                      tasks: { type: "array", items: { $ref: "#/components/schemas/Task" } },
                      count: { type: "integer", minimum: 0 },
                      total: { type: "integer", minimum: 0 },
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
          requestBody: {
            required: false,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CompleteTaskInput" } } },
          },
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
      "/v1/plans": {
        get: {
          operationId: "listPlans",
          summary: "List plans",
          parameters: [{ name: "project_id", in: "query", schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: { plans: { type: "array", items: { $ref: "#/components/schemas/Plan" } }, count: { type: "number" } } } } } },
          },
        },
        post: {
          operationId: "createPlan",
          summary: "Create a plan",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreatePlanInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { type: "object", properties: { plan: { $ref: "#/components/schemas/Plan" } } } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/plans/{id}": {
        get: {
          operationId: "getPlan",
          summary: "Get a plan by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { plan: { $ref: "#/components/schemas/Plan" } } } } } } },
        },
        patch: {
          operationId: "updatePlan",
          summary: "Update a plan",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdatePlanInput" } } },
          },
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: { plan: { $ref: "#/components/schemas/Plan" } } } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
        delete: {
          operationId: "deletePlan",
          summary: "Delete a plan and detach its tasks",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { deleted: { type: "boolean" }, id: { type: "string" } } } } } } },
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

function stageAOperationId(route: TodosStageARoute): string {
  const suffix = `${route.method} ${route.path}`
    .replace(/\{([^}]+)\}/g, " by $1 ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  return `todosStageA${suffix}`;
}

function stageAResponse(route: TodosStageARoute, status: string): Record<string, unknown> {
  if (status === "400") {
    const schema = route.family === "v1-dispatch" || route.family === "generic-options"
      ? { $ref: "#/components/schemas/StageACallerAuthorityRejected" }
      : {
          oneOf: [
            { $ref: "#/components/schemas/StageACallerAuthorityRejected" },
            { $ref: "#/components/schemas/ErrorEnvelope" },
          ],
        };
    return {
      description: "Caller authority was rejected, or a local request failed validation.",
      content: { "application/json": { schema } },
    };
  }
  if (status === "503") {
    return route.path === "/ready"
      ? {
          description: "The process is live but hosted storage authority is unavailable.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/StageAReadinessUnavailable" } } },
        }
      : {
          description: "Trusted hosted authority is unavailable before datastore or transport dependencies.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/StageAHostedAuthorityUnavailable" } } },
        };
  }
  if (status === "429") {
    return {
      description: "The shared post-containment request rate limit was exceeded.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/RateLimitExceeded" } } },
    };
  }
  if (status === "202") {
    return { description: "The MCP JSON-RPC notification was accepted with no response body." };
  }
  if (status === "200" || status === "201") {
    return { description: status === "201" ? "A local resource was created." : "Request completed." };
  }
  return {
    description: "The finite route returned its documented error envelope.",
    content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
  };
}

function stageADescription(route: TodosStageARoute): string {
  if (route.family === "v1-dispatch") {
    return "Disabled in Stage A. Caller-supplied authority returns 400 and every ordinary request returns 503 before verifier, schema, storage, or cloud imports.";
  }
  if (route.family === "generic-options") {
    return "Finite CORS preflight. It is exempt from the post-containment rate limiter; sensitive hosted paths may still return 400 or 503 at the earlier containment floor.";
  }
  if (route.family === "service-probe" || route.family === "openapi-probe") {
    return "Unauthenticated finite metadata probe evaluated after containment and the shared rate limiter.";
  }
  if (route.family === "mcp-runtime") {
    return "Authorized local MCP transport route. Hosted processes terminate at the Stage A containment floor before MCP imports.";
  }
  return "Authorized local REST route. Hosted processes terminate at the Stage A containment floor before local route, authentication, or datastore dependencies.";
}

/** Build the only OpenAPI contract served while hosted authority is disabled. */
export function buildV1OpenApiDocument(version = getPackageVersion()) {
  const paths: Record<string, Record<string, Record<string, unknown>>> = {};

  for (const route of TODOS_STAGE_A_ROUTES) {
    const parameters = [...route.path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
      name: match[1]!,
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const operation: Record<string, unknown> = {
      operationId: stageAOperationId(route),
      summary: `${route.method} ${route.path}`,
      description: stageADescription(route),
      "x-stage-a-enabled": route.family !== "v1-dispatch",
      "x-stage-a-dispatch-family": route.family,
      "x-stage-a-rate-limited": route.family !== "generic-options" && route.family !== "v1-dispatch",
      "x-stage-a-cors": route.family === "generic-options" || route.path.startsWith("/api/") || route.path === "/mcp",
      ...(route.family === "local-runtime" || route.family === "mcp-runtime"
        ? { "x-local-api-key": true }
        : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      responses: Object.fromEntries(route.statuses.map((status) => [status, stageAResponse(route, status)])),
    };
    paths[route.path] ??= {};
    paths[route.path]![route.method.toLowerCase()] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Todos V1 API — Stage A containment",
      version,
      description:
        "Stage A fail-closed hosted boundary. There is no authenticated success path: ordinary hosted calls return 503 and caller-forged authority claims return 400 before dependencies, request bodies, or datastore access.",
    },
    servers: [{ url: "/" }],
    components: {
      schemas: {
        StageAHostedAuthorityUnavailable: {
          type: "object",
          additionalProperties: false,
          required: ["error", "code", "reason"],
          properties: {
            error: { type: "string", const: "hosted_authority_unavailable" },
            code: { type: "string", const: "HOSTED_AUTHORITY_UNAVAILABLE" },
            reason: { type: "string", const: "authority_resolver_unavailable" },
          },
        },
        StageACallerAuthorityRejected: {
          type: "object",
          additionalProperties: false,
          required: ["error", "code", "source"],
          properties: {
            error: { type: "string", const: "caller_authority_rejected" },
            code: { type: "string", const: "CALLER_AUTHORITY_REJECTED" },
            source: { type: "string", enum: ["header", "query"] },
          },
        },
        StageAReadinessUnavailable: {
          type: "object",
          additionalProperties: false,
          required: ["status", "version", "mode", "code", "reason"],
          properties: {
            status: { type: "string", const: "unavailable" },
            version: { type: "string" },
            mode: { type: "string", const: "remote" },
            code: { type: "string", const: "HOSTED_AUTHORITY_UNAVAILABLE" },
            reason: { type: "string", const: "authority_resolver_unavailable" },
          },
        },
        RateLimitExceeded: {
          type: "object",
          additionalProperties: false,
          required: ["error", "retry_after"],
          properties: {
            error: { type: "string", const: "Too many requests" },
            retry_after: { type: "number" },
          },
        },
        ErrorEnvelope: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string" },
            code: { type: "string" },
          },
          additionalProperties: true,
        },
      },
    },
    security: [],
    paths,
    "x-stage-a-dispatch-order": TODOS_STAGE_A_DISPATCH_ORDER,
    "x-stage-a-rate-limit": {
      containment_before_limiter: true,
      finite_options_exempt: true,
      probes_may_return_429: true,
    },
    "x-stage-a-sensitive-fallbacks": {
      applies_after_containment: true,
      api_mcp_unknown_path: { status: 404, family: "sensitive-not-found", no_io: true },
      api_mcp_unsupported_method: { status: 405, family: "sensitive-method-not-allowed", no_io: true },
      v1_unknown_or_unsupported: {
        statuses: [400, 503],
        family: "hosted-containment",
        no_io: true,
        precedes_finite_route_classification: true,
      },
    },
    "x-stage-a-cors": {
      finite_options_only: true,
      v1_containment_precedes_cors: true,
      allowed_methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowed_headers: ["Content-Type", "X-API-Key", "Authorization"],
    },
    "x-future-positive-contract": {
      enabled: false,
      description:
        "The future authenticated success schemas are retained by buildFutureV1OpenApiDocument and are not served or enabled in Stage A.",
    },
  };
}
