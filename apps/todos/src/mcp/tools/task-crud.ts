// @ts-nocheck
/**
 * Task CRUD tools for the MCP server.
 * Auto-extracted from src/mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Task } from "../../types/index.js";
import { createTask, listTasks, getTask, updateTask, deleteTask } from "../../db/tasks.js";
import { TaskNotFoundError, VersionConflictError } from "../../types/index.js";

interface TaskCrudContext {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table?: string) => string;
  formatError: (error: unknown) => string;
  formatTask: (task: Task) => string;
  formatTaskDetail: (task: Task, maxDescriptionChars?: number) => string;
  getAgentFocus: (agentId: string) => { agent_id: string; project_id?: string } | undefined;
}

export function registerTaskCrudTools(server: McpServer, ctx: TaskCrudContext) {
  const { shouldRegisterTool, resolveId, formatError, formatTask } = ctx;

  // === CREATE TASK ===

  if (shouldRegisterTool("create_task")) {
    server.tool(
      "create_task",
      "Create a new task in a project. Pass short_id=null to auto-generate.",
      {
        title: z.string().describe("Task title"),
        description: z.string().optional().describe("Task description (markdown)"),
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional().describe("Initial status (default: pending)"),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Priority (default: medium)"),
        project_id: z.string().optional().describe("Project ID"),
        task_list_id: z.string().optional().describe("Task list ID"),
        assigned_to: z.string().optional().describe("Agent ID or name to assign to"),
        depends_on: z.array(z.string()).optional().describe("Array of task IDs this task depends on"),
        short_id: z.string().nullable().optional().describe("Short ID (auto-generated if not provided, disabled if null)"),
        tags: z.array(z.string()).optional().describe("Tags for the task"),
        estimate: z.number().optional().describe("Estimated minutes to complete"),
        confidence: z.number().min(0).max(1).optional().describe("Confidence score 0.0-1.0"),
        deadline: z.string().optional().describe("ISO deadline"),
        retry_count: z.number().optional().describe("Max retry count for agent failures"),
      },
      async (params) => {
        try {
          const { depends_on, assigned_to, project_id, task_list_id, tags, estimate, confidence, retry_count, deadline, ...rest } = params;
          const resolved: Record<string, unknown> = { ...rest };
          if (assigned_to) resolved.assigned_to = resolveId(assigned_to, "agents");
          if (project_id) resolved.project_id = resolveId(project_id, "projects");
          if (task_list_id) resolved.task_list_id = resolveId(task_list_id, "task_lists");
          if (depends_on) resolved.depends_on = depends_on.map(resolveId);
          if (tags) resolved.tags = tags;
          if (estimate !== undefined) resolved.estimated_minutes = estimate;
          if (confidence !== undefined) resolved.confidence = confidence;
          if (retry_count !== undefined) resolved.retry_count = retry_count;
          if (deadline) resolved.deadline = deadline;

          const task = createTask(resolved as Parameters<typeof createTask>[0]);
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === LIST TASKS ===

  if (shouldRegisterTool("list_tasks")) {
    server.tool(
      "list_tasks",
      "List tasks with optional filters. Pass empty arrays for multi-value filters (e.g. status=[] shows all).",
      {
        status: z.union([z.enum(["pending", "in_progress", "completed", "cancelled"]), z.array(z.enum(["pending", "in_progress", "completed", "cancelled"]))]).optional().describe("Filter by status"),
        priority: z.union([z.enum(["low", "medium", "high", "urgent"]), z.array(z.enum(["low", "medium", "high", "urgent"]))]).optional().describe("Filter by priority"),
        project_id: z.string().optional().describe("Filter by project"),
        task_list_id: z.string().optional().describe("Filter by task list"),
        assigned_to: z.string().optional().describe("Filter by assignee (agent ID or name, empty string = unassigned)"),
        tags: z.array(z.string()).optional().describe("Filter by tags (AND logic)"),
        created_after: z.string().optional().describe("ISO date — tasks created after this date"),
        created_before: z.string().optional().describe("ISO date — tasks created before this date"),
        limit: z.number().optional().describe("Max results (default: 50, max 500)"),
        offset: z.number().optional().describe("Pagination offset"),
      },
      async (params) => {
        try {
          const resolved: Record<string, unknown> = { ...params };
          if (params.project_id) resolved.project_id = resolveId(params.project_id, "projects");
          if (params.task_list_id) resolved.task_list_id = resolveId(params.task_list_id, "task_lists");
          if (params.assigned_to) resolved.assigned_to = resolveId(params.assigned_to, "agents");
          const tasks = listTasks(resolved as Parameters<typeof listTasks>[0], undefined) as Task[];
          if (tasks.length === 0) return { content: [{ type: "text" as const, text: "No tasks found." }] };
          const lines = tasks.map(formatTask);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === GET TASK ===

  if (shouldRegisterTool("get_task")) {
    server.tool(
      "get_task",
      "Get full details for a task.",
      {
        task_id: z.string().describe("Task ID (full or short)"),
      },
      async ({ task_id }) => {
        try {
          const resolvedId = resolveId(task_id);
          const task = getTask(resolvedId);
          if (!task) throw new NotFoundError(`Task not found: ${task_id}`);
          const focus = ctx.getAgentFocus(task.assigned_to || "");
          const lines = [
            `ID:       ${task.id}`,
            `Short ID: ${task.short_id || "(none)"}`,
            `Title:    ${task.title}`,
            `Status:   ${task.status} | Priority: ${task.priority}`,
            task.assigned_to ? `Assigned: ${task.assigned_to}` : null,
            task.project_id ? `Project:  ${task.project_id}` : null,
            task.depends_on?.length ? `Depends:  ${task.depends_on.join(", ")}` : null,
            task.tags?.length ? `Tags:     ${task.tags.join(", ")}` : null,
            task.estimated_minutes != null ? `Estimate: ${task.estimated_minutes} min` : null,
            task.actual_minutes != null ? `Actual:   ${task.actual_minutes} min` : null,
            task.confidence != null ? `Confidence: ${task.confidence}` : null,
            task.deadline ? `Deadline: ${task.deadline}` : null,
            task.completed_at ? `Completed: ${task.completed_at}` : null,
            focus ? `Focus:    agent=${focus.agent_id} project=${focus.project_id || "(global)"}` : null,
            task.created_at ? `Created:  ${task.created_at}` : null,
            task.updated_at ? `Updated:  ${task.updated_at}` : null,
            task.metadata && Object.keys(task.metadata).length > 0 ? `\nMetadata: ${JSON.stringify(task.metadata)}` : null,
            task.description ? `\n${task.description}` : null,
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === UPDATE TASK ===

  if (shouldRegisterTool("update_task")) {
    server.tool(
      "update_task",
      "Update a task's fields. Uses optimistic locking — throws ConflictError if version mismatch.",
      {
        task_id: z.string().describe("Task ID"),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        assigned_to: z.string().nullable().optional().describe("Agent ID or name, null to unassign"),
        project_id: z.string().nullable().optional(),
        task_list_id: z.string().nullable().optional(),
        depends_on: z.array(z.string()).optional().describe("Full replacement array of dependency IDs"),
        tags: z.array(z.string()).optional(),
        estimate: z.number().optional().describe("Estimated minutes"),
        actual_minutes: z.number().optional().describe("Actual minutes worked"),
        confidence: z.number().min(0).max(1).optional(),
        approved_by: z.string().optional().describe("Agent ID who approved this task"),
        completed_at: z.string().optional().describe("ISO timestamp for backdating completion"),
        deadline: z.string().nullable().optional(),
        retry_count: z.number().optional(),
        version: z.number().optional().describe("Expected version for optimistic locking"),
      },
      async (params) => {
        try {
          const resolvedId = resolveId(params.task_id);
          const { task_id, version, ...updates } = params;
          const resolved: Record<string, unknown> = { ...updates };
          if (resolved.assigned_to === "") resolved.assigned_to = null;
          if (resolved.assigned_to && typeof resolved.assigned_to === "string") resolved.assigned_to = resolveId(resolved.assigned_to, "agents");
          if (resolved.project_id && typeof resolved.project_id === "string") resolved.project_id = resolveId(resolved.project_id, "projects");
          if (resolved.task_list_id && typeof resolved.task_list_id === "string") resolved.task_list_id = resolveId(resolved.task_list_id, "task_lists");
          if (resolved.depends_on && Array.isArray(resolved.depends_on)) resolved.depends_on = (resolved.depends_on as string[]).map(resolveId);
          if (resolved.estimate !== undefined) resolved.estimated_minutes = resolved.estimate;

          const task = updateTask(resolvedId, resolved as Parameters<typeof updateTask>[1], version);
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === DELETE TASK ===

  if (shouldRegisterTool("delete_task")) {
    server.tool(
      "delete_task",
      "Permanently delete a task. Fails if the task has active children (tasks that depend on it).",
      {
        task_id: z.string().describe("Task ID"),
        force: z.boolean().optional().describe("Skip child check (dangerous)"),
      },
      async ({ task_id, force }) => {
        try {
          const resolvedId = resolveId(task_id);
          deleteTask(resolvedId, force);
          return { content: [{ type: "text" as const, text: `Task ${task_id.slice(0, 8)} deleted.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
