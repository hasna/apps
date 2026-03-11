/**
 * OpenAI-compatible function/tool schemas for @hasna/todos.
 * Use with any agent framework that supports OpenAI function calling.
 *
 * Usage with OpenAI:
 *   const tools = todosTools.map(t => ({ type: "function", function: t }));
 *
 * Usage with Anthropic:
 *   const tools = todosTools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
 */

export const todosTools = [
  {
    name: "todos_create_task",
    description: "Create a new task",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Task description (supports markdown)" },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Task priority" },
        project_id: { type: "string", description: "Project ID" },
        plan_id: { type: "string", description: "Plan ID" },
        tags: { type: "array", items: { type: "string" }, description: "Tags" },
        assigned_to: { type: "string", description: "Assign to agent" },
        estimated_minutes: { type: "number", description: "Estimated time in minutes" },
        requires_approval: { type: "boolean", description: "Require approval before completion" },
      },
      required: ["title"],
    },
  },
  {
    name: "todos_list_tasks",
    description: "List tasks with optional filters",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "in_progress", "completed", "failed", "cancelled"] },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
        project_id: { type: "string" },
        plan_id: { type: "string" },
        assigned_to: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "todos_get_task",
    description: "Get full task details",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Task ID" } },
      required: ["id"],
    },
  },
  {
    name: "todos_start_task",
    description: "Claim, lock, and start a task",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Task ID" } },
      required: ["id"],
    },
  },
  {
    name: "todos_complete_task",
    description: "Complete a task with optional evidence",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID" },
        evidence: {
          type: "object",
          properties: {
            files_changed: { type: "array", items: { type: "string" } },
            test_results: { type: "string" },
            commit_hash: { type: "string" },
            notes: { type: "string" },
          },
        },
      },
      required: ["id"],
    },
  },
  {
    name: "todos_claim_task",
    description: "Atomically find and claim the next available task",
    parameters: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
        tags: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "todos_update_task",
    description: "Update task fields",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["pending", "in_progress", "completed", "failed", "cancelled"] },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
        assigned_to: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
    },
  },
  {
    name: "todos_delete_task",
    description: "Delete a task",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "todos_approve_task",
    description: "Approve a task that requires approval",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "todos_get_queue",
    description: "Get your task queue — what to work on next, sorted by priority",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "todos_get_stats",
    description: "Get dashboard statistics (total tasks, pending, completed, etc.)",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "todos_create_plan",
    description: "Create a new plan",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        project_id: { type: "string" },
        status: { type: "string", enum: ["active", "completed", "archived"] },
      },
      required: ["name"],
    },
  },
  {
    name: "todos_list_plans",
    description: "List all plans",
    parameters: {
      type: "object",
      properties: { project_id: { type: "string" } },
    },
  },
  {
    name: "todos_search_tasks",
    description: "Search tasks by keyword",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "todos_get_history",
    description: "Get change history for a task (audit log)",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
] as const;

export type TodosToolName = (typeof todosTools)[number]["name"];
