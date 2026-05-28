// @ts-nocheck
/**
 * Task project tools for the MCP server.
 * Auto-extracted from src/mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Task } from "../../types/index.js";
import {
  getTask, updateTask, createTask, listTasks,
  addTaskDependency, removeTaskDependency,
  createProject, listProjects, getProject, updateProject, deleteProject,
  createTaskList, listTaskLists, getTaskList, updateTaskList, deleteTaskList,
  createPlan, listPlans, getPlan, updatePlan, deletePlan,
  createTag, listTags, getTag, updateTag, deleteTag,
  createLabel, listLabels, getLabel, updateLabel, deleteLabel,
  createComment, listComments, updateComment, deleteComment,
} from "../../tasks.js";
import { NotFoundError } from "../../errors.js";

interface TaskProjectContext {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table?: string) => string;
  formatError: (error: unknown) => string;
  formatTask: (task: Task) => string;
  formatTaskDetail: (task: Task, maxDescriptionChars?: number) => string;
  getAgentFocus: (agentId: string) => { agent_id: string; project_id?: string } | undefined;
}

export function registerTaskProjectTools(server: McpServer, ctx: TaskProjectContext) {
  const { shouldRegisterTool, resolveId, formatError, formatTask } = ctx;

  // === TASK STATE ===

  if (shouldRegisterTool("start_task")) {
    server.tool(
      "start_task",
      "Mark a task as in_progress. Uses optimistic locking via version if provided.",
      {
        task_id: z.string().describe("Task ID"),
        version: z.number().optional().describe("Expected version for optimistic locking"),
      },
      async ({ task_id, version }) => {
        try {
          const resolvedId = resolveId(task_id);
          const task = updateTask(resolvedId, { status: "in_progress" }, version);
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("complete_task")) {
    server.tool(
      "complete_task",
      "Mark a task completed. Optionally set confidence, score, and completion timestamp.",
      {
        task_id: z.string().describe("Task ID"),
        confidence: z.number().min(0).max(1).optional().describe("Confidence score 0.0-1.0"),
        completed_at: z.string().optional().describe("ISO timestamp for backdating"),
        version: z.number().optional().describe("Expected version for optimistic locking"),
      },
      async ({ task_id, confidence, completed_at, version }) => {
        try {
          const resolvedId = resolveId(task_id);
          const task = updateTask(resolvedId, { status: "completed", confidence, completed_at }, version);
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("cancel_task")) {
    server.tool(
      "cancel_task",
      "Mark a task as cancelled.",
      {
        task_id: z.string().describe("Task ID"),
        version: z.number().optional().describe("Expected version for optimistic locking"),
      },
      async ({ task_id, version }) => {
        try {
          const resolvedId = resolveId(task_id);
          const task = updateTask(resolvedId, { status: "cancelled" }, version);
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("reassign_task")) {
    server.tool(
      "reassign_task",
      "Reassign a task to a different agent.",
      {
        task_id: z.string().describe("Task ID"),
        new_assignee: z.string().describe("New agent ID or name"),
        version: z.number().optional().describe("Expected version for optimistic locking"),
      },
      async ({ task_id, new_assignee, version }) => {
        try {
          const resolvedId = resolveId(task_id);
          const resolvedAssignee = resolveId(new_assignee, "agents");
          const task = updateTask(resolvedId, { assigned_to: resolvedAssignee }, version);
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("reschedule_task")) {
    server.tool(
      "reschedule_task",
      "Update a task's deadline.",
      {
        task_id: z.string().describe("Task ID"),
        deadline: z.string().describe("New ISO deadline"),
        version: z.number().optional().describe("Expected version for optimistic locking"),
      },
      async ({ task_id, deadline, version }) => {
        try {
          const resolvedId = resolveId(task_id);
          const task = updateTask(resolvedId, { deadline }, version);
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("prioritize_task")) {
    server.tool(
      "prioritize_task",
      "Set a task's priority.",
      {
        task_id: z.string().describe("Task ID"),
        priority: z.enum(["low", "medium", "high", "urgent"]).describe("New priority"),
        version: z.number().optional().describe("Expected version for optimistic locking"),
      },
      async ({ task_id, priority, version }) => {
        try {
          const resolvedId = resolveId(task_id);
          const task = updateTask(resolvedId, { priority }, version);
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === DEPENDENCIES ===

  if (shouldRegisterTool("add_task_dependency")) {
    server.tool(
      "add_task_dependency",
      "Add a dependency (this task won't start until the dependency completes).",
      {
        task_id: z.string().describe("Task ID that has the dependency"),
        depends_on: z.string().describe("Task ID this task depends on"),
      },
      async ({ task_id, depends_on }) => {
        try {
          const resolvedId = resolveId(task_id);
          const resolvedDep = resolveId(depends_on);
          addTaskDependency(resolvedId, resolvedDep);
          return { content: [{ type: "text" as const, text: `${resolvedId.slice(0,8)} now depends on ${resolvedDep.slice(0,8)}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("remove_task_dependency")) {
    server.tool(
      "remove_task_dependency",
      "Remove a dependency between two tasks.",
      {
        task_id: z.string().describe("Task ID"),
        depends_on: z.string().describe("Task ID to remove dependency on"),
      },
      async ({ task_id, depends_on }) => {
        try {
          removeTaskDependency(resolveId(task_id), resolveId(depends_on));
          return { content: [{ type: "text" as const, text: "Dependency removed." }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_task_dependencies")) {
    server.tool(
      "get_task_dependencies",
      "Get full dependency tree for a task.",
      {
        task_id: z.string().describe("Task ID"),
        direction: z.enum(["upstream", "downstream", "both"]).optional().describe("Upstream = tasks this task depends on; downstream = tasks depending on this"),
      },
      async ({ task_id, direction }) => {
        try {
          const { getTaskDependencies } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          const deps = getTaskDependencies(resolveId(task_id), direction);
          if (deps.length === 0) return { content: [{ type: "text" as const, text: "No dependencies." }] };
          const lines = deps.map((d: any) => `[${d.direction}] ${d.task_id.slice(0,8)} (${d.status})`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === BULK OPERATIONS ===

  if (shouldRegisterTool("bulk_update_tasks")) {
    server.tool(
      "bulk_update_tasks",
      "Update multiple tasks at once. All tasks must pass the dependency check.",
      {
        task_ids: z.array(z.string()).describe("Array of task IDs to update"),
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        assigned_to: z.string().nullable().optional().describe("Agent ID or name, null to unassign"),
      },
      async ({ task_ids, status, priority, assigned_to }) => {
        try {
          const { bulkUpdateTasks } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          const resolved = task_ids.map(resolveId);
          let resolvedAssignee: string | null | undefined = assigned_to;
          if (resolvedAssignee && typeof resolvedAssignee === "string") resolvedAssignee = resolveId(resolvedAssignee, "agents");
          const result = bulkUpdateTasks(resolved, { status, priority, assigned_to: resolvedAssignee });
          return { content: [{ type: "text" as const, text: `${result.updated} task(s) updated, ${result.skipped} skipped (dependency check).` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("bulk_create_tasks")) {
    server.tool(
      "bulk_create_tasks",
      "Create multiple tasks at once from an array of task objects.",
      {
        tasks: z.array(z.object({
          title: z.string(),
          description: z.string().optional(),
          status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
          priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
          project_id: z.string().optional(),
          task_list_id: z.string().optional(),
          assigned_to: z.string().optional(),
          depends_on: z.array(z.string()).optional(),
          short_id: z.string().nullable().optional(),
          tags: z.array(z.string()).optional(),
          estimate: z.number().optional(),
        })).describe("Array of task objects"),
      },
      async ({ tasks }) => {
        try {
          const { bulkCreateTasks } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          const resolved = tasks.map(t => {
            const r: Record<string, unknown> = { ...t };
            if (r.project_id) r.project_id = resolveId(r.project_id as string, "projects");
            if (r.task_list_id) r.task_list_id = resolveId(r.task_list_id as string, "task_lists");
            if (r.assigned_to) r.assigned_to = resolveId(r.assigned_to as string, "agents");
            if (r.depends_on) r.depends_on = (r.depends_on as string[]).map((id: string) => resolveId(id));
            return r as Parameters<typeof bulkCreateTasks>[0][number];
          });
          const result = bulkCreateTasks(resolved);
          return { content: [{ type: "text" as const, text: `${result.created} task(s) created, ${result.skipped} skipped (duplicate short_id).` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("bulk_delete_tasks")) {
    server.tool(
      "bulk_delete_tasks",
      "Delete multiple tasks at once. Tasks with active children are skipped.",
      {
        task_ids: z.array(z.string()).describe("Array of task IDs"),
        force: z.boolean().optional().describe("Skip child check for all tasks (dangerous)"),
      },
      async ({ task_ids, force }) => {
        try {
          const { bulkDeleteTasks } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          const resolved = task_ids.map(resolveId);
          const result = bulkDeleteTasks(resolved, force);
          return { content: [{ type: "text" as const, text: `${result.deleted} task(s) deleted, ${result.skipped} skipped (has children).` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === PROJECT LIFECYCLE ===

  if (shouldRegisterTool("create_project")) {
    server.tool(
      "create_project",
      "Create a new project.",
      {
        name: z.string().describe("Project name"),
        description: z.string().optional(),
        status: z.enum(["active", "completed", "on_hold", "archived"]).optional(),
        short_id: z.string().nullable().optional().describe("Short ID (auto-generated if omitted)"),
        metadata: z.record(z.unknown()).optional(),
      },
      async (params) => {
        try {
          const project = createProject(params as Parameters<typeof createProject>[0]);
          return { content: [{ type: "text" as const, text: `Project created: ${project.id.slice(0,8)} ${project.name}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_projects")) {
    server.tool(
      "list_projects",
      "List all projects.",
      {
        status: z.enum(["active", "completed", "on_hold", "archived"]).optional(),
        limit: z.number().optional(),
      },
      async ({ status, limit }) => {
        try {
          const projects = listProjects({ status, limit });
          if (projects.length === 0) return { content: [{ type: "text" as const, text: "No projects found." }] };
          const lines = projects.map(p => `[${p.status}] ${p.short_id || p.id.slice(0,8)} ${p.name}`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_project")) {
    server.tool(
      "get_project",
      "Get full details for a project.",
      {
        project_id: z.string().describe("Project ID (full or short)"),
      },
      async ({ project_id }) => {
        try {
          const resolvedId = resolveId(project_id, "projects");
          const project = getProject(resolvedId);
          if (!project) throw new NotFoundError(`Project not found: ${project_id}`);
          const { listTasks } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          const tasks = listTasks({ project_id: resolvedId, limit: 100 }, undefined) as Task[];
          const lines = [
            `ID:          ${project.id}`,
            `Short ID:    ${project.short_id || "(none)"}`,
            `Name:        ${project.name}`,
            `Status:      ${project.status}`,
            project.description ? `Description: ${project.description}` : null,
            `Tasks:       ${tasks.length}`,
            project.metadata && Object.keys(project.metadata).length > 0 ? `Metadata:    ${JSON.stringify(project.metadata)}` : null,
            project.created_at ? `Created:     ${project.created_at}` : null,
            project.updated_at ? `Updated:     ${project.updated_at}` : null,
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_project")) {
    server.tool(
      "update_project",
      "Update a project's fields.",
      {
        project_id: z.string().describe("Project ID"),
        name: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(["active", "completed", "on_hold", "archived"]).optional(),
        metadata: z.record(z.unknown()).optional(),
      },
      async (params) => {
        try {
          const { project_id, ...updates } = params;
          const resolvedId = resolveId(project_id, "projects");
          const project = updateProject(resolvedId, updates as Parameters<typeof updateProject>[1]);
          return { content: [{ type: "text" as const, text: `Project ${project.short_id || project.id.slice(0,8)} updated.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_project")) {
    server.tool(
      "delete_project",
      "Permanently delete a project and all its tasks.",
      {
        project_id: z.string().describe("Project ID"),
        force: z.boolean().optional().describe("Skip confirmation (dangerous)"),
      },
      async ({ project_id, force }) => {
        try {
          deleteProject(resolveId(project_id, "projects"), force);
          return { content: [{ type: "text" as const, text: `Project ${project_id.slice(0, 8)} deleted.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === TASK LISTS ===

  if (shouldRegisterTool("create_task_list")) {
    server.tool(
      "create_task_list",
      "Create a new task list.",
      {
        name: z.string().describe("Task list name"),
        project_id: z.string().optional().describe("Project ID"),
        description: z.string().optional(),
        status: z.enum(["active", "completed", "archived"]).optional(),
      },
      async (params) => {
        try {
          const resolved: Record<string, unknown> = { ...params };
          if (params.project_id) resolved.project_id = resolveId(params.project_id, "projects");
          const list = createTaskList(resolved as Parameters<typeof createTaskList>[0]);
          return { content: [{ type: "text" as const, text: `Task list created: ${list.id.slice(0,8)} ${list.name}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_task_lists")) {
    server.tool(
      "list_task_lists",
      "List all task lists.",
      {
        project_id: z.string().optional().describe("Filter by project"),
        status: z.enum(["active", "completed", "archived"]).optional(),
      },
      async ({ project_id, status }) => {
        try {
          const resolved: Record<string, unknown> = { status };
          if (project_id) resolved.project_id = resolveId(project_id, "projects");
          const lists = listTaskLists(resolved as Parameters<typeof listTaskLists>[0]);
          if (lists.length === 0) return { content: [{ type: "text" as const, text: "No task lists found." }] };
          const lines = lists.map(l => `[${l.status}] ${l.name} (${l.id.slice(0,8)})`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_task_list")) {
    server.tool(
      "get_task_list",
      "Get a task list with its tasks.",
      {
        task_list_id: z.string().describe("Task list ID"),
        include_tasks: z.boolean().optional().describe("Include tasks (default: true)"),
      },
      async ({ task_list_id, include_tasks = true }) => {
        try {
          const resolvedId = resolveId(task_list_id, "task_lists");
          const list = getTaskList(resolvedId);
          if (!list) throw new NotFoundError(`Task list not found: ${task_list_id}`);
          let tasks: Task[] = [];
          if (include_tasks) {
            const { listTasks } = require("../db/tasks.js") as typeof import("../db/tasks.js");
            tasks = listTasks({ task_list_id: resolvedId, limit: 200 }, undefined) as Task[];
          }
          const lines = [
            `ID:    ${list.id}`,
            `Name:  ${list.name}`,
            list.project_id ? `Project: ${list.project_id}` : null,
            `Tasks: ${tasks.length}`,
            tasks.length > 0 ? "\nTasks:" : null,
            ...tasks.map(t => `  ${t.status} [${t.priority}] ${t.title} (${t.id.slice(0,8)})`),
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_task_list")) {
    server.tool(
      "update_task_list",
      "Update a task list's fields.",
      {
        task_list_id: z.string().describe("Task list ID"),
        name: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(["active", "completed", "archived"]).optional(),
      },
      async ({ task_list_id, ...updates }) => {
        try {
          const resolvedId = resolveId(task_list_id, "task_lists");
          const list = updateTaskList(resolvedId, updates as Parameters<typeof updateTaskList>[1]);
          return { content: [{ type: "text" as const, text: `Task list ${list.id.slice(0,8)} updated.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_task_list")) {
    server.tool(
      "delete_task_list",
      "Permanently delete a task list and all its tasks.",
      {
        task_list_id: z.string().describe("Task list ID"),
        force: z.boolean().optional().describe("Skip confirmation (dangerous)"),
      },
      async ({ task_list_id, force }) => {
        try {
          deleteTaskList(resolveId(task_list_id, "task_lists"), force);
          return { content: [{ type: "text" as const, text: `Task list ${task_list_id.slice(0, 8)} deleted.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === PLANS ===

  if (shouldRegisterTool("create_plan")) {
    server.tool(
      "create_plan",
      "Create a new plan (sprint/milestone).",
      {
        name: z.string().describe("Plan name"),
        project_id: z.string().optional().describe("Project ID"),
        description: z.string().optional(),
        start_date: z.string().optional().describe("ISO date"),
        end_date: z.string().optional().describe("ISO date"),
        status: z.enum(["planning", "active", "completed", "cancelled"]).optional(),
      },
      async (params) => {
        try {
          const resolved: Record<string, unknown> = { ...params };
          if (params.project_id) resolved.project_id = resolveId(params.project_id, "projects");
          const plan = createPlan(resolved as Parameters<typeof createPlan>[0]);
          return { content: [{ type: "text" as const, text: `Plan created: ${plan.id.slice(0,8)} ${plan.name}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_plans")) {
    server.tool(
      "list_plans",
      "List plans.",
      {
        project_id: z.string().optional().describe("Filter by project"),
        status: z.enum(["planning", "active", "completed", "cancelled"]).optional(),
      },
      async ({ project_id, status }) => {
        try {
          const resolved: Record<string, unknown> = { status };
          if (project_id) resolved.project_id = resolveId(project_id, "projects");
          const plans = listPlans(resolved as Parameters<typeof listPlans>[0]);
          if (plans.length === 0) return { content: [{ type: "text" as const, text: "No plans found." }] };
          const lines = plans.map(p => `[${p.status}] ${p.name} (${p.id.slice(0,8)})`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_plan")) {
    server.tool(
      "get_plan",
      "Get a plan with its tasks.",
      {
        plan_id: z.string().describe("Plan ID"),
        include_tasks: z.boolean().optional().describe("Include tasks (default: true)"),
      },
      async ({ plan_id, include_tasks = true }) => {
        try {
          const resolvedId = resolveId(plan_id, "plans");
          const plan = getPlan(resolvedId);
          if (!plan) throw new NotFoundError(`Plan not found: ${plan_id}`);
          let tasks: Task[] = [];
          if (include_tasks) {
            const { listTasks } = require("../db/tasks.js") as typeof import("../db/tasks.js");
            tasks = listTasks({ plan_id: resolvedId, limit: 200 }, undefined) as Task[];
          }
          const lines = [
            `ID:    ${plan.id}`,
            `Name:  ${plan.name}`,
            `Status: ${plan.status}`,
            plan.project_id ? `Project: ${plan.project_id}` : null,
            plan.start_date ? `Start:   ${plan.start_date}` : null,
            plan.end_date ? `End:     ${plan.end_date}` : null,
            `Tasks: ${tasks.length}`,
            tasks.length > 0 ? "\nTasks:" : null,
            ...tasks.map(t => `  ${t.status} [${t.priority}] ${t.title} (${t.id.slice(0,8)})`),
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_plan")) {
    server.tool(
      "update_plan",
      "Update a plan's fields.",
      {
        plan_id: z.string().describe("Plan ID"),
        name: z.string().optional(),
        description: z.string().optional(),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        status: z.enum(["planning", "active", "completed", "cancelled"]).optional(),
      },
      async ({ plan_id, ...updates }) => {
        try {
          const resolvedId = resolveId(plan_id, "plans");
          const plan = updatePlan(resolvedId, updates as Parameters<typeof updatePlan>[1]);
          return { content: [{ type: "text" as const, text: `Plan ${plan.id.slice(0,8)} updated.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_plan")) {
    server.tool(
      "delete_plan",
      "Permanently delete a plan and all its tasks.",
      {
        plan_id: z.string().describe("Plan ID"),
        force: z.boolean().optional().describe("Skip confirmation (dangerous)"),
      },
      async ({ plan_id, force }) => {
        try {
          deletePlan(resolveId(plan_id, "plans"), force);
          return { content: [{ type: "text" as const, text: `Plan ${plan_id.slice(0, 8)} deleted.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === TAGS ===

  if (shouldRegisterTool("create_tag")) {
    server.tool(
      "create_tag",
      "Create a new tag.",
      {
        name: z.string().describe("Tag name"),
        color: z.string().optional().describe("Hex color code"),
        description: z.string().optional(),
      },
      async (params) => {
        try {
          const tag = createTag(params as Parameters<typeof createTag>[0]);
          return { content: [{ type: "text" as const, text: `Tag created: ${tag.name}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_tags")) {
    server.tool(
      "list_tags",
      "List all tags.",
      async () => {
        try {
          const tags = listTags();
          if (tags.length === 0) return { content: [{ type: "text" as const, text: "No tags found." }] };
          const lines = tags.map(t => `${t.color ? "[" + t.color + "] " : ""}${t.name}`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_tag")) {
    server.tool(
      "get_tag",
      "Get a tag and list of tasks using it.",
      {
        tag_id: z.string().describe("Tag ID or name"),
      },
      async ({ tag_id }) => {
        try {
          const tag = getTag(tag_id);
          if (!tag) throw new NotFoundError(`Tag not found: ${tag_id}`);
          const { listTasks } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          const tasks = listTasks({ tags: [tag.name], limit: 100 }, undefined) as Task[];
          const lines = [
            `Tag: ${tag.name}${tag.color ? ` (${tag.color})` : ""}`,
            tag.description ? `Description: ${tag.description}` : null,
            `Tasks: ${tasks.length}`,
            ...tasks.slice(0, 20).map(t => `  ${t.status} ${t.title} (${t.id.slice(0,8)})`),
            tasks.length > 20 ? `  ... and ${tasks.length - 20} more` : null,
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_tag")) {
    server.tool(
      "update_tag",
      "Update a tag's fields.",
      {
        tag_id: z.string().describe("Tag ID or name"),
        name: z.string().optional(),
        color: z.string().optional(),
        description: z.string().optional(),
      },
      async ({ tag_id, ...updates }) => {
        try {
          const tag = updateTag(tag_id, updates as Parameters<typeof updateTag>[1]);
          return { content: [{ type: "text" as const, text: `Tag ${tag.name} updated.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_tag")) {
    server.tool(
      "delete_tag",
      "Permanently delete a tag. Removes it from all tasks.",
      {
        tag_id: z.string().describe("Tag ID or name"),
      },
      async ({ tag_id }) => {
        try {
          deleteTag(tag_id);
          return { content: [{ type: "text" as const, text: `Tag deleted: ${tag_id}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === LABELS ===

  if (shouldRegisterTool("create_label")) {
    server.tool(
      "create_label",
      "Create a new label.",
      {
        name: z.string().describe("Label name"),
        color: z.string().optional().describe("Hex color code"),
        description: z.string().optional(),
      },
      async (params) => {
        try {
          const label = createLabel(params as Parameters<typeof createLabel>[0]);
          return { content: [{ type: "text" as const, text: `Label created: ${label.name}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_labels")) {
    server.tool(
      "list_labels",
      "List all labels.",
      async () => {
        try {
          const labels = listLabels();
          if (labels.length === 0) return { content: [{ type: "text" as const, text: "No labels found." }] };
          const lines = labels.map(l => `${l.color ? "[" + l.color + "] " : ""}${l.name}`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_label")) {
    server.tool(
      "get_label",
      "Get a label and list of tasks using it.",
      {
        label_id: z.string().describe("Label ID or name"),
      },
      async ({ label_id }) => {
        try {
          const label = getLabel(label_id);
          if (!label) throw new NotFoundError(`Label not found: ${label_id}`);
          const { listTasks } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          const tasks = listTasks({ tags: [label.name], limit: 100 }, undefined) as Task[];
          const lines = [
            `Label: ${label.name}${label.color ? ` (${label.color})` : ""}`,
            label.description ? `Description: ${label.description}` : null,
            `Tasks: ${tasks.length}`,
            ...tasks.slice(0, 20).map(t => `  ${t.status} ${t.title} (${t.id.slice(0,8)})`),
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_label")) {
    server.tool(
      "update_label",
      "Update a label's fields.",
      {
        label_id: z.string().describe("Label ID or name"),
        name: z.string().optional(),
        color: z.string().optional(),
        description: z.string().optional(),
      },
      async ({ label_id, ...updates }) => {
        try {
          const label = updateLabel(label_id, updates as Parameters<typeof updateLabel>[1]);
          return { content: [{ type: "text" as const, text: `Label ${label.name} updated.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_label")) {
    server.tool(
      "delete_label",
      "Permanently delete a label.",
      {
        label_id: z.string().describe("Label ID or name"),
      },
      async ({ label_id }) => {
        try {
          deleteLabel(label_id);
          return { content: [{ type: "text" as const, text: `Label deleted: ${label_id}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === COMMENTS ===

  if (shouldRegisterTool("create_comment")) {
    server.tool(
      "create_comment",
      "Add a comment to a task.",
      {
        task_id: z.string().describe("Task ID"),
        body: z.string().describe("Comment body"),
        author: z.string().optional().describe("Author agent ID or name"),
      },
      async ({ task_id, body, author }) => {
        try {
          const resolvedId = resolveId(task_id);
          const resolvedAuthor = author ? resolveId(author, "agents") : undefined;
          const comment = createComment({ task_id: resolvedId, body, author: resolvedAuthor });
          return { content: [{ type: "text" as const, text: `Comment added to ${task_id.slice(0,8)}: ${body.slice(0, 50)}${body.length > 50 ? "..." : ""}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_comments")) {
    server.tool(
      "list_comments",
      "List all comments on a task.",
      {
        task_id: z.string().describe("Task ID"),
      },
      async ({ task_id }) => {
        try {
          const resolvedId = resolveId(task_id);
          const comments = listComments(resolvedId);
          if (comments.length === 0) return { content: [{ type: "text" as const, text: "No comments." }] };
          const lines = comments.map(c => `[${c.author || "unknown"}] ${c.created_at?.slice(0, 16)}:\n  ${c.body}`);
          return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_comment")) {
    server.tool(
      "update_comment",
      "Edit a comment.",
      {
        comment_id: z.string().describe("Comment ID"),
        body: z.string().describe("New comment body"),
      },
      async ({ comment_id, body }) => {
        try {
          const comment = updateComment(comment_id, { body });
          return { content: [{ type: "text" as const, text: `Comment ${comment_id.slice(0,8)} updated.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_comment")) {
    server.tool(
      "delete_comment",
      "Delete a comment.",
      {
        comment_id: z.string().describe("Comment ID"),
      },
      async ({ comment_id }) => {
        try {
          deleteComment(comment_id);
          return { content: [{ type: "text" as const, text: `Comment ${comment_id.slice(0,8)} deleted.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === SEARCH ===

  if (shouldRegisterTool("search_tasks")) {
    server.tool(
      "search_tasks",
      "Full-text search across task titles and descriptions.",
      {
        query: z.string().describe("Search query"),
        project_id: z.string().optional().describe("Filter by project"),
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
        limit: z.number().optional().describe("Max results (default: 20)"),
      },
      async ({ query, project_id, status, limit }) => {
        try {
          const { searchTasks } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          const resolved: Record<string, unknown> = { query, limit };
          if (project_id) resolved.project_id = resolveId(project_id, "projects");
          if (status) resolved.status = status;
          const results = searchTasks(resolved as Parameters<typeof searchTasks>[0]);
          if (results.length === 0) return { content: [{ type: "text" as const, text: `No results for: ${query}` }] };
          const lines = results.map((t: any) => `${(t.short_id || t.id.slice(0,8))} [${t.status}] ${t.title}`);
          return { content: [{ type: "text" as const, text: `${results.length} result(s) for "${query}":\n${lines.join("\n")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === SYNC ===

  if (shouldRegisterTool("sync")) {
    server.tool(
      "sync",
      "Sync tasks from a GitHub PR or external source into the project.",
      {
        source: z.enum(["github_pr", "linear", "asana"]).describe("Source type"),
        source_id: z.string().describe("PR number, Linear issue ID, or Asana task ID"),
        project_id: z.string().optional().describe("Project ID to import into"),
        options: z.record(z.unknown()).optional().describe("Source-specific options"),
      },
      async ({ source, source_id, project_id, options }) => {
        try {
          const { syncFromGithubPR, syncFromLinear, syncFromAsana } = require("../lib/sync.js") as typeof import("../lib/sync.js");
          let result: any;
          if (source === "github_pr") {
            result = await syncFromGithubPR({ prNumber: parseInt(source_id), project_id: project_id ? resolveId(project_id, "projects") : undefined, ...options as any });
          } else if (source === "linear") {
            result = await syncFromLinear({ issueId: source_id, project_id: project_id ? resolveId(project_id, "projects") : undefined, ...options as any });
          } else {
            result = await syncFromAsana({ taskId: source_id, project_id: project_id ? resolveId(project_id, "projects") : undefined, ...options as any });
          }
          return { content: [{ type: "text" as const, text: `Synced from ${source}: ${result.task?.title || source_id}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
