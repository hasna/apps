#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createTask,
  getTaskWithRelations,
  listTasks,
  updateTask,
  deleteTask,
  startTask,
  completeTask,
  lockTask,
  unlockTask,
  addDependency,
  removeDependency,
} from "../db/tasks.js";
import { addComment } from "../db/comments.js";
import {
  createProject,
  getProject,
  listProjects,
} from "../db/projects.js";
import {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
} from "../db/plans.js";
import { registerAgent, getAgent, getAgentByName, listAgents } from "../db/agents.js";
import { createTaskList, getTaskList, listTaskLists, updateTaskList, deleteTaskList } from "../db/task-lists.js";
import { searchTasks } from "../lib/search.js";
import { defaultSyncAgents, syncWithAgent, syncWithAgents } from "../lib/sync.js";
import { getAgentTaskListId } from "../lib/config.js";
import { getDatabase, resolvePartialId } from "../db/database.js";
import {
  VersionConflictError,
  TaskNotFoundError,
  LockError,
  DependencyCycleError,
  PlanNotFoundError,
  TaskListNotFoundError,
  CompletionGuardError,
} from "../types/index.js";
import type { Task } from "../types/index.js";

const server = new McpServer({
  name: "todos",
  version: "0.9.15",
});

function formatError(error: unknown): string {
  if (error instanceof VersionConflictError) return `Version conflict: ${error.message}`;
  if (error instanceof TaskNotFoundError) return `Not found: ${error.message}`;
  if (error instanceof PlanNotFoundError) return `Not found: ${error.message}`;
  if (error instanceof TaskListNotFoundError) return `Not found: ${error.message}`;
  if (error instanceof LockError) return `Lock error: ${error.message}`;
  if (error instanceof DependencyCycleError) return `Dependency cycle: ${error.message}`;
  if (error instanceof CompletionGuardError) {
    const retry = error.retryAfterSeconds ? ` (retry after ${error.retryAfterSeconds}s)` : "";
    return `Completion blocked: ${error.reason}${retry}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function resolveId(partialId: string, table = "tasks"): string {
  const db = getDatabase();
  const id = resolvePartialId(db, table, partialId);
  if (!id) throw new Error(`Could not resolve ID: ${partialId}`);
  return id;
}

function resolveTaskListId(agent: string, explicit?: string): string | null {
  if (explicit) return explicit;
  const normalized = agent.trim().toLowerCase();
  if (normalized === "claude" || normalized === "claude-code" || normalized === "claude_code") {
    return process.env["TODOS_CLAUDE_TASK_LIST"]
      || process.env["CLAUDE_CODE_TASK_LIST_ID"]
      || process.env["CLAUDE_CODE_SESSION_ID"]
      || getAgentTaskListId(normalized)
      || null;
  }
  const key = `TODOS_${normalized.toUpperCase()}_TASK_LIST`;
  return process.env[key]
    || process.env["TODOS_TASK_LIST_ID"]
    || getAgentTaskListId(normalized)
    || "default";
}

/** Compact single-line task summary for mutation responses (create/update/start/complete). */
function formatTask(task: Task): string {
  const id = task.short_id || task.id.slice(0, 8);
  const assigned = task.assigned_to ? ` -> ${task.assigned_to}` : "";
  const lock = task.locked_by ? ` [locked:${task.locked_by}]` : "";
  return `${id} ${task.status.padEnd(11)} ${task.priority.padEnd(8)} ${task.title}${assigned}${lock}`;
}

/** Full multi-line task detail for get_task responses. */
function formatTaskDetail(task: Task): string {
  const parts = [
    `ID: ${task.id}`,
    `Title: ${task.title}`,
    `Status: ${task.status}`,
    `Priority: ${task.priority}`,
  ];
  if (task.description) parts.push(`Description: ${task.description}`);
  if (task.assigned_to) parts.push(`Assigned to: ${task.assigned_to}`);
  if (task.agent_id) parts.push(`Agent: ${task.agent_id}`);
  if (task.locked_by) parts.push(`Locked by: ${task.locked_by}`);
  if (task.parent_id) parts.push(`Parent: ${task.parent_id}`);
  if (task.project_id) parts.push(`Project: ${task.project_id}`);
  if (task.plan_id) parts.push(`Plan: ${task.plan_id}`);
  if (task.tags.length > 0) parts.push(`Tags: ${task.tags.join(", ")}`);
  parts.push(`Version: ${task.version}`);
  parts.push(`Created: ${task.created_at}`);
  if (task.completed_at) parts.push(`Completed: ${task.completed_at}`);
  return parts.join("\n");
}

// === TOOLS ===

// 1. create_task
server.tool(
  "create_task",
  "Create a new task",
  {
    title: z.string(),
    description: z.string().optional(),
    project_id: z.string().optional(),
    parent_id: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
    agent_id: z.string().optional(),
    assigned_to: z.string().optional(),
    session_id: z.string().optional(),
    working_dir: z.string().optional(),
    plan_id: z.string().optional(),
    task_list_id: z.string().optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
    estimated_minutes: z.number().optional(),
    requires_approval: z.boolean().optional(),
  },
  async (params) => {
    try {
      const resolved = { ...params };
      if (resolved.project_id) resolved.project_id = resolveId(resolved.project_id, "projects");
      if (resolved.parent_id) resolved.parent_id = resolveId(resolved.parent_id);
      if (resolved.plan_id) resolved.plan_id = resolveId(resolved.plan_id, "plans");
      if (resolved.task_list_id) resolved.task_list_id = resolveId(resolved.task_list_id, "task_lists");
      const task = createTask(resolved);
      return { content: [{ type: "text" as const, text: `created: ${formatTask(task)}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// 2. list_tasks
server.tool(
  "list_tasks",
  "List tasks with optional filters",
  {
    project_id: z.string().optional(),
    status: z.union([
      z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]),
      z.array(z.enum(["pending", "in_progress", "completed", "failed", "cancelled"])),
    ]).optional(),
    priority: z.union([
      z.enum(["low", "medium", "high", "critical"]),
      z.array(z.enum(["low", "medium", "high", "critical"])),
    ]).optional(),
    assigned_to: z.string().optional(),
    tags: z.array(z.string()).optional(),
    plan_id: z.string().optional(),
    task_list_id: z.string().optional(),
  },
  async (params) => {
    try {
      const resolved = { ...params };
      if (resolved.project_id) resolved.project_id = resolveId(resolved.project_id, "projects");
      if (resolved.plan_id) resolved.plan_id = resolveId(resolved.plan_id, "plans");
      if (resolved.task_list_id) resolved.task_list_id = resolveId(resolved.task_list_id, "task_lists");
      const tasks = listTasks(resolved);
      if (tasks.length === 0) {
        return { content: [{ type: "text" as const, text: "No tasks found." }] };
      }
      const text = tasks.map((t) => {
        const lock = t.locked_by ? ` [locked by ${t.locked_by}]` : "";
        const assigned = t.assigned_to ? ` -> ${t.assigned_to}` : "";
        return `[${t.status}] ${t.id.slice(0, 8)} | ${t.priority} | ${t.title}${assigned}${lock}`;
      }).join("\n");
      return { content: [{ type: "text" as const, text: `${tasks.length} task(s):\n${text}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// 3. get_task
server.tool(
  "get_task",
  "Get full task details with relations",
  {
    id: z.string(),
  },
  async ({ id }) => {
    try {
      const resolvedId = resolveId(id);
      const task = getTaskWithRelations(resolvedId);
      if (!task) return { content: [{ type: "text" as const, text: `Task not found: ${id}` }], isError: true };

      const parts = [formatTaskDetail(task)];

      if (task.subtasks.length > 0) {
        parts.push(`\nSubtasks (${task.subtasks.length}):`);
        for (const st of task.subtasks) {
          parts.push(`  [${st.status}] ${st.id.slice(0, 8)} | ${st.title}`);
        }
      }
      if (task.dependencies.length > 0) {
        parts.push(`\nDepends on (${task.dependencies.length}):`);
        for (const dep of task.dependencies) {
          parts.push(`  [${dep.status}] ${dep.id.slice(0, 8)} | ${dep.title}`);
        }
      }
      if (task.blocked_by.length > 0) {
        parts.push(`\nBlocks (${task.blocked_by.length}):`);
        for (const b of task.blocked_by) {
          parts.push(`  [${b.status}] ${b.id.slice(0, 8)} | ${b.title}`);
        }
      }
      if (task.comments.length > 0) {
        parts.push(`\nComments (${task.comments.length}):`);
        for (const c of task.comments) {
          const agent = c.agent_id ? `[${c.agent_id}] ` : "";
          parts.push(`  ${agent}${c.created_at}: ${c.content}`);
        }
      }
      if (task.parent) {
        parts.push(`\nParent: ${task.parent.id.slice(0, 8)} | ${task.parent.title}`);
      }

      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// 4. update_task
server.tool(
  "update_task",
  "Update task fields. Version required for optimistic locking.",
  {
    id: z.string(),
    version: z.number(),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    assigned_to: z.string().optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
    plan_id: z.string().optional(),
    task_list_id: z.string().optional(),
  },
  async ({ id, ...rest }) => {
    try {
      const resolvedId = resolveId(id);
      const task = updateTask(resolvedId, rest);
      return { content: [{ type: "text" as const, text: `updated: ${formatTask(task)}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// 5. delete_task
server.tool(
  "delete_task",
  "Delete a task permanently",
  {
    id: z.string(),
  },
  async ({ id }) => {
    try {
      const resolvedId = resolveId(id);
      const deleted = deleteTask(resolvedId);
      return {
        content: [{
          type: "text" as const,
          text: deleted ? `Task ${id} deleted.` : `Task ${id} not found.`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// 6. start_task
server.tool(
  "start_task",
  "Claim, lock, and set task status to in_progress.",
  {
    id: z.string(),
    agent_id: z.string(),
  },
  async ({ id, agent_id }) => {
    try {
      const resolvedId = resolveId(id);
      const task = startTask(resolvedId, agent_id);
      return { content: [{ type: "text" as const, text: `started: ${formatTask(task)}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// 7. complete_task
server.tool(
  "complete_task",
  "Mark task completed and release lock.",
  {
    id: z.string(),
    agent_id: z.string().optional(),
  },
  async ({ id, agent_id }) => {
    try {
      const resolvedId = resolveId(id);
      const task = completeTask(resolvedId, agent_id);
      return { content: [{ type: "text" as const, text: `completed: ${formatTask(task)}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// 8. lock_task
server.tool(
  "lock_task",
  "Acquire exclusive lock on a task",
  {
    id: z.string(),
    agent_id: z.string(),
  },
  async ({ id, agent_id }) => {
    try {
      const resolvedId = resolveId(id);
      const result = lockTask(resolvedId, agent_id);
      if (result.success) {
        return { content: [{ type: "text" as const, text: `Lock acquired by ${agent_id} at ${result.locked_at}` }] };
      }
      return { content: [{ type: "text" as const, text: `Lock failed: ${result.error}` }], isError: true };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// 9. unlock_task
server.tool(
  "unlock_task",
  "Release exclusive lock on a task",
  {
    id: z.string(),
    agent_id: z.string().optional(),
  },
  async ({ id, agent_id }) => {
    try {
      const resolvedId = resolveId(id);
      unlockTask(resolvedId, agent_id);
      return { content: [{ type: "text" as const, text: `Lock released on task ${id}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// 10. add_dependency
server.tool(
  "add_dependency",
  "Add a dependency: task_id depends on depends_on.",
  {
    task_id: z.string(),
    depends_on: z.string(),
  },
  async ({ task_id, depends_on }) => {
    try {
      const resolvedTaskId = resolveId(task_id);
      const resolvedDepsOn = resolveId(depends_on);
      addDependency(resolvedTaskId, resolvedDepsOn);
      return { content: [{ type: "text" as const, text: `Dependency added: ${task_id} depends on ${depends_on}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// 11. remove_dependency
server.tool(
  "remove_dependency",
  "Remove a dependency between tasks",
  {
    task_id: z.string(),
    depends_on: z.string(),
  },
  async ({ task_id, depends_on }) => {
    try {
      const resolvedTaskId = resolveId(task_id);
      const resolvedDepsOn = resolveId(depends_on);
      const removed = removeDependency(resolvedTaskId, resolvedDepsOn);
      return {
        content: [{
          type: "text" as const,
          text: removed ? `Dependency removed.` : `Dependency not found.`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// 12. add_comment
server.tool(
  "add_comment",
  "Add a comment/note to a task",
  {
    task_id: z.string(),
    content: z.string(),
    agent_id: z.string().optional(),
    session_id: z.string().optional(),
  },
  async ({ task_id, ...rest }) => {
    try {
      const resolvedId = resolveId(task_id);
      const comment = addComment({ task_id: resolvedId, ...rest });
      return { content: [{ type: "text" as const, text: `Comment added (${comment.id.slice(0, 8)}) at ${comment.created_at}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// 13. list_projects
server.tool(
  "list_projects",
  "List all registered projects",
  {},
  async () => {
    try {
      const projects = listProjects();
      if (projects.length === 0) {
        return { content: [{ type: "text" as const, text: "No projects registered." }] };
      }
      const text = projects.map((p) => {
        const taskList = p.task_list_id ? ` [${p.task_list_id}]` : "";
        return `${p.id.slice(0, 8)} | ${p.name} | ${p.path}${taskList}${p.description ? ` - ${p.description}` : ""}`;
      }).join("\n");
      return { content: [{ type: "text" as const, text: `${projects.length} project(s):\n${text}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// 14. create_project
server.tool(
  "create_project",
  "Register a new project",
  {
    name: z.string(),
    path: z.string(),
    description: z.string().optional(),
    task_list_id: z.string().optional(),
  },
  async (params) => {
    try {
      const project = createProject(params);
      const taskList = project.task_list_id ? ` [${project.task_list_id}]` : "";
      return {
        content: [{
          type: "text" as const,
          text: `Project created: ${project.id.slice(0, 8)} | ${project.name} | ${project.path}${taskList}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// create_plan
server.tool(
  "create_plan",
  "Create a new plan",
  {
    name: z.string(),
    project_id: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(["active", "completed", "archived"]).optional(),
    task_list_id: z.string().optional(),
    agent_id: z.string().optional(),
  },
  async (params) => {
    try {
      const resolved = { ...params };
      if (resolved.project_id) resolved.project_id = resolveId(resolved.project_id, "projects");
      if (resolved.task_list_id) resolved.task_list_id = resolveId(resolved.task_list_id, "task_lists");
      const plan = createPlan(resolved);
      return {
        content: [{
          type: "text" as const,
          text: `Plan created: ${plan.id.slice(0, 8)} | ${plan.name} | ${plan.status}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// list_plans
server.tool(
  "list_plans",
  "List plans with optional project filter",
  {
    project_id: z.string().optional(),
  },
  async ({ project_id }) => {
    try {
      const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
      const plans = listPlans(resolvedProjectId);
      if (plans.length === 0) {
        return { content: [{ type: "text" as const, text: "No plans found." }] };
      }
      const text = plans.map((p) => {
        const project = p.project_id ? ` (project: ${p.project_id.slice(0, 8)})` : "";
        return `[${p.status}] ${p.id.slice(0, 8)} | ${p.name}${project}`;
      }).join("\n");
      return { content: [{ type: "text" as const, text: `${plans.length} plan(s):\n${text}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// get_plan
server.tool(
  "get_plan",
  "Get plan details",
  {
    id: z.string(),
  },
  async ({ id }) => {
    try {
      const resolvedId = resolveId(id, "plans");
      const plan = getPlan(resolvedId);
      if (!plan) return { content: [{ type: "text" as const, text: `Plan not found: ${id}` }], isError: true };
      const parts = [
        `ID: ${plan.id}`,
        `Name: ${plan.name}`,
        `Status: ${plan.status}`,
      ];
      if (plan.description) parts.push(`Description: ${plan.description}`);
      if (plan.project_id) parts.push(`Project: ${plan.project_id}`);
      parts.push(`Created: ${plan.created_at}`);
      parts.push(`Updated: ${plan.updated_at}`);
      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// update_plan
server.tool(
  "update_plan",
  "Update a plan",
  {
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(["active", "completed", "archived"]).optional(),
    task_list_id: z.string().optional(),
    agent_id: z.string().optional(),
  },
  async ({ id, ...rest }) => {
    try {
      const resolvedId = resolveId(id, "plans");
      const resolved = { ...rest };
      if (resolved.task_list_id) resolved.task_list_id = resolveId(resolved.task_list_id, "task_lists");
      const plan = updatePlan(resolvedId, resolved);
      return {
        content: [{
          type: "text" as const,
          text: `Plan updated: ${plan.id.slice(0, 8)} | ${plan.name} | ${plan.status}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// delete_plan
server.tool(
  "delete_plan",
  "Delete a plan",
  {
    id: z.string(),
  },
  async ({ id }) => {
    try {
      const resolvedId = resolveId(id, "plans");
      const deleted = deletePlan(resolvedId);
      return {
        content: [{
          type: "text" as const,
          text: deleted ? `Plan ${id} deleted.` : `Plan ${id} not found.`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// 15. search_tasks
server.tool(
  "search_tasks",
  "Full-text search across task titles, descriptions, tags.",
  {
    query: z.string(),
    project_id: z.string().optional(),
    task_list_id: z.string().optional(),
  },
  async ({ query, project_id, task_list_id }) => {
    try {
      const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
      const resolvedTaskListId = task_list_id ? resolveId(task_list_id, "task_lists") : undefined;
      const tasks = searchTasks(query, resolvedProjectId, resolvedTaskListId);
      if (tasks.length === 0) {
        return { content: [{ type: "text" as const, text: `No tasks matching "${query}".` }] };
      }
      const text = tasks.map((t) =>
        `[${t.status}] ${t.id.slice(0, 8)} | ${t.priority} | ${t.title}`,
      ).join("\n");
      return { content: [{ type: "text" as const, text: `${tasks.length} result(s) for "${query}":\n${text}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// 16. sync
server.tool(
  "sync",
  "Sync tasks with an agent task list.",
  {
    task_list_id: z.string().optional(),
    agent: z.string().optional(),
    all_agents: z.boolean().optional(),
    project_id: z.string().optional(),
    direction: z.enum(["push", "pull", "both"]).optional(),
    prefer: z.enum(["local", "remote"]).optional(),
  },
  async ({ task_list_id, agent, all_agents, project_id, direction, prefer }) => {
    try {
      const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
      const project = resolvedProjectId ? getProject(resolvedProjectId) : undefined;
      const dir = direction ?? "both";
      const options = { prefer: prefer ?? "remote" };

      let result;
      if (all_agents) {
        const agents = defaultSyncAgents();
        result = syncWithAgents(
          agents,
          (a) => resolveTaskListId(a, task_list_id || project?.task_list_id || undefined),
          resolvedProjectId,
          dir,
          options,
        );
      } else {
        const resolvedAgent = agent || "claude";
        const taskListId = resolveTaskListId(resolvedAgent, task_list_id || project?.task_list_id || undefined);
        if (!taskListId) {
          return {
            content: [{
              type: "text" as const,
              text: `Could not determine task list ID for ${resolvedAgent}. Provide task_list_id or set task_list_id on the project.`,
            }],
            isError: true,
          };
        }
        result = syncWithAgent(resolvedAgent, taskListId, resolvedProjectId, dir, options);
      }

      const parts: string[] = [];
      if (result.pulled > 0) parts.push(`Pulled ${result.pulled} task(s).`);
      if (result.pushed > 0) parts.push(`Pushed ${result.pushed} task(s).`);
      if (result.pulled === 0 && result.pushed === 0 && result.errors.length === 0) {
        parts.push("Nothing to sync.");
      }
      for (const err of result.errors) {
        parts.push(`Error: ${err}`);
      }

      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// === AGENT TOOLS ===

// register_agent
server.tool(
  "register_agent",
  "Register an agent (idempotent by name).",
  {
    name: z.string(),
    description: z.string().optional(),
  },
  async ({ name, description }) => {
    try {
      const agent = registerAgent({ name, description });
      return {
        content: [{
          type: "text" as const,
          text: `Agent registered:\nID: ${agent.id}\nName: ${agent.name}${agent.description ? `\nDescription: ${agent.description}` : ""}\nCreated: ${agent.created_at}\nLast seen: ${agent.last_seen_at}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// list_agents
server.tool(
  "list_agents",
  "List all registered agents",
  {},
  async () => {
    try {
      const agents = listAgents();
      if (agents.length === 0) {
        return { content: [{ type: "text" as const, text: "No agents registered." }] };
      }
      const text = agents.map((a) => {
        return `${a.id} | ${a.name}${a.description ? ` - ${a.description}` : ""} (last seen: ${a.last_seen_at})`;
      }).join("\n");
      return { content: [{ type: "text" as const, text: `${agents.length} agent(s):\n${text}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// get_agent
server.tool(
  "get_agent",
  "Get agent details by ID or name",
  {
    id: z.string().optional(),
    name: z.string().optional(),
  },
  async ({ id, name }) => {
    try {
      if (!id && !name) {
        return { content: [{ type: "text" as const, text: "Provide either id or name." }], isError: true };
      }
      const agent = id ? getAgent(id) : getAgentByName(name!);
      if (!agent) {
        return { content: [{ type: "text" as const, text: `Agent not found: ${id || name}` }], isError: true };
      }
      const parts = [
        `ID: ${agent.id}`,
        `Name: ${agent.name}`,
      ];
      if (agent.description) parts.push(`Description: ${agent.description}`);
      if (Object.keys(agent.metadata).length > 0) parts.push(`Metadata: ${JSON.stringify(agent.metadata)}`);
      parts.push(`Created: ${agent.created_at}`);
      parts.push(`Last seen: ${agent.last_seen_at}`);
      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// === TASK LIST TOOLS ===

// create_task_list
server.tool(
  "create_task_list",
  "Create a new task list",
  {
    name: z.string(),
    slug: z.string().optional(),
    project_id: z.string().optional(),
    description: z.string().optional(),
  },
  async (params) => {
    try {
      const resolved = { ...params };
      if (resolved.project_id) resolved.project_id = resolveId(resolved.project_id, "projects");
      const list = createTaskList(resolved);
      return {
        content: [{
          type: "text" as const,
          text: `Task list created:\nID: ${list.id}\nName: ${list.name}\nSlug: ${list.slug}${list.project_id ? `\nProject: ${list.project_id}` : ""}${list.description ? `\nDescription: ${list.description}` : ""}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// list_task_lists
server.tool(
  "list_task_lists",
  "List task lists, optionally filtered by project",
  {
    project_id: z.string().optional(),
  },
  async ({ project_id }) => {
    try {
      const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
      const lists = listTaskLists(resolvedProjectId);
      if (lists.length === 0) {
        return { content: [{ type: "text" as const, text: "No task lists found." }] };
      }
      const text = lists.map((l) => {
        const project = l.project_id ? ` (project: ${l.project_id.slice(0, 8)})` : "";
        return `${l.id.slice(0, 8)} | ${l.name} [${l.slug}]${project}${l.description ? ` - ${l.description}` : ""}`;
      }).join("\n");
      return { content: [{ type: "text" as const, text: `${lists.length} task list(s):\n${text}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// get_task_list
server.tool(
  "get_task_list",
  "Get task list details",
  {
    id: z.string(),
  },
  async ({ id }) => {
    try {
      const resolvedId = resolveId(id, "task_lists");
      const list = getTaskList(resolvedId);
      if (!list) {
        return { content: [{ type: "text" as const, text: `Task list not found: ${id}` }], isError: true };
      }
      const parts = [
        `ID: ${list.id}`,
        `Name: ${list.name}`,
        `Slug: ${list.slug}`,
      ];
      if (list.project_id) parts.push(`Project: ${list.project_id}`);
      if (list.description) parts.push(`Description: ${list.description}`);
      if (Object.keys(list.metadata).length > 0) parts.push(`Metadata: ${JSON.stringify(list.metadata)}`);
      parts.push(`Created: ${list.created_at}`);
      parts.push(`Updated: ${list.updated_at}`);
      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// update_task_list
server.tool(
  "update_task_list",
  "Update a task list",
  {
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
  },
  async ({ id, ...rest }) => {
    try {
      const resolvedId = resolveId(id, "task_lists");
      const list = updateTaskList(resolvedId, rest);
      return {
        content: [{
          type: "text" as const,
          text: `Task list updated:\nID: ${list.id}\nName: ${list.name}\nSlug: ${list.slug}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// delete_task_list
server.tool(
  "delete_task_list",
  "Delete a task list. Tasks lose association but keep data.",
  {
    id: z.string(),
  },
  async ({ id }) => {
    try {
      const resolvedId = resolveId(id, "task_lists");
      const deleted = deleteTaskList(resolvedId);
      return {
        content: [{
          type: "text" as const,
          text: deleted ? `Task list ${id} deleted.` : `Task list ${id} not found.`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// === AUDIT LOG TOOLS ===

// get_task_history
server.tool(
  "get_task_history",
  "Get audit log for a task.",
  {
    task_id: z.string(),
  },
  async ({ task_id }) => {
    try {
      const resolvedId = resolveId(task_id);
      const { getTaskHistory } = await import("../db/audit.js");
      const history = getTaskHistory(resolvedId);
      if (history.length === 0) return { content: [{ type: "text" as const, text: "No history for this task." }] };
      const text = history.map(h => `${h.created_at} | ${h.action}${h.field ? ` ${h.field}` : ""}${h.old_value ? ` from "${h.old_value}"` : ""}${h.new_value ? ` to "${h.new_value}"` : ""}${h.agent_id ? ` by ${h.agent_id}` : ""}`).join("\n");
      return { content: [{ type: "text" as const, text: `${history.length} change(s):\n${text}` }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);

// get_recent_activity
server.tool(
  "get_recent_activity",
  "Get recent task changes across all tasks.",
  {
    limit: z.number().optional(),
  },
  async ({ limit }) => {
    try {
      const { getRecentActivity } = await import("../db/audit.js");
      const activity = getRecentActivity(limit || 50);
      if (activity.length === 0) return { content: [{ type: "text" as const, text: "No recent activity." }] };
      const text = activity.map(h => `${h.created_at} | ${h.task_id.slice(0, 8)} | ${h.action}${h.field ? ` ${h.field}` : ""}${h.agent_id ? ` by ${h.agent_id}` : ""}`).join("\n");
      return { content: [{ type: "text" as const, text: `${activity.length} recent change(s):\n${text}` }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);

// === WEBHOOK TOOLS ===

// create_webhook
server.tool(
  "create_webhook",
  "Register a webhook to receive task change events.",
  {
    url: z.string(),
    events: z.array(z.string()).optional(),
    secret: z.string().optional(),
  },
  async (params) => {
    try {
      const { createWebhook } = await import("../db/webhooks.js");
      const wh = createWebhook(params);
      return { content: [{ type: "text" as const, text: `Webhook created: ${wh.id.slice(0, 8)} | ${wh.url} | events: ${wh.events.length === 0 ? "all" : wh.events.join(",")}` }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);

// list_webhooks
server.tool(
  "list_webhooks",
  "List all registered webhooks",
  {},
  async () => {
    try {
      const { listWebhooks } = await import("../db/webhooks.js");
      const webhooks = listWebhooks();
      if (webhooks.length === 0) return { content: [{ type: "text" as const, text: "No webhooks registered." }] };
      const text = webhooks.map(w => `${w.id.slice(0, 8)} | ${w.active ? "active" : "inactive"} | ${w.url} | events: ${w.events.length === 0 ? "all" : w.events.join(",")}`).join("\n");
      return { content: [{ type: "text" as const, text: `${webhooks.length} webhook(s):\n${text}` }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);

// delete_webhook
server.tool(
  "delete_webhook",
  "Delete a webhook",
  {
    id: z.string(),
  },
  async ({ id }) => {
    try {
      const { deleteWebhook } = await import("../db/webhooks.js");
      const deleted = deleteWebhook(id);
      return { content: [{ type: "text" as const, text: deleted ? "Webhook deleted." : "Webhook not found." }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);

// === TEMPLATE TOOLS ===

// create_template
server.tool(
  "create_template",
  "Create a reusable task template.",
  {
    name: z.string(),
    title_pattern: z.string(),
    description: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    tags: z.array(z.string()).optional(),
    project_id: z.string().optional(),
    plan_id: z.string().optional(),
  },
  async (params) => {
    try {
      const { createTemplate } = await import("../db/templates.js");
      const t = createTemplate(params);
      return { content: [{ type: "text" as const, text: `Template created: ${t.id.slice(0, 8)} | ${t.name} | "${t.title_pattern}"` }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);

// list_templates
server.tool(
  "list_templates",
  "List all task templates",
  {},
  async () => {
    try {
      const { listTemplates } = await import("../db/templates.js");
      const templates = listTemplates();
      if (templates.length === 0) return { content: [{ type: "text" as const, text: "No templates." }] };
      const text = templates.map(t => `${t.id.slice(0, 8)} | ${t.name} | "${t.title_pattern}" | ${t.priority}`).join("\n");
      return { content: [{ type: "text" as const, text: `${templates.length} template(s):\n${text}` }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);

// create_task_from_template
server.tool(
  "create_task_from_template",
  "Create a task from a template with optional overrides.",
  {
    template_id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    assigned_to: z.string().optional(),
    project_id: z.string().optional(),
  },
  async (params) => {
    try {
      const { taskFromTemplate } = await import("../db/templates.js");
      const input = taskFromTemplate(params.template_id, {
        title: params.title, description: params.description,
        priority: params.priority as any, assigned_to: params.assigned_to, project_id: params.project_id,
      });
      const task = createTask(input);
      return { content: [{ type: "text" as const, text: `Task created from template:\n${task.id.slice(0, 8)} | ${task.priority} | ${task.title}` }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);

// delete_template
server.tool(
  "delete_template",
  "Delete a task template",
  { id: z.string() },
  async ({ id }) => {
    try {
      const { deleteTemplate } = await import("../db/templates.js");
      const deleted = deleteTemplate(id);
      return { content: [{ type: "text" as const, text: deleted ? "Template deleted." : "Template not found." }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);

// === APPROVAL TOOLS ===

// approve_task
server.tool(
  "approve_task",
  "Approve a task that requires approval.",
  {
    id: z.string(),
    agent_id: z.string().optional(),
  },
  async ({ id, agent_id }) => {
    try {
      const resolvedId = resolveId(id);
      const task = getTaskWithRelations(resolvedId);
      if (!task) return { content: [{ type: "text" as const, text: `Task not found: ${id}` }], isError: true };
      if (!task.requires_approval) return { content: [{ type: "text" as const, text: `Task ${id} does not require approval.` }] };
      if (task.approved_by) return { content: [{ type: "text" as const, text: `Task already approved by ${task.approved_by}.` }] };
      const updated = updateTask(resolvedId, { approved_by: agent_id || "system", version: task.version });
      return { content: [{ type: "text" as const, text: `Task approved by ${agent_id || "system"}: ${updated.id.slice(0, 8)} | ${updated.title}` }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);

// get_my_tasks — agent discovery
server.tool(
  "get_my_tasks",
  "Get assigned tasks and stats for an agent.",
  {
    agent_name: z.string(),
  },
  async ({ agent_name }) => {
    try {
      const agent = registerAgent({ name: agent_name });
      const tasks = listTasks({});
      const myTasks = tasks.filter(t => t.assigned_to === agent_name || t.assigned_to === agent.id || t.agent_id === agent.id || t.agent_id === agent_name);
      const pending = myTasks.filter(t => t.status === "pending");
      const inProgress = myTasks.filter(t => t.status === "in_progress");
      const completed = myTasks.filter(t => t.status === "completed");
      const rate = myTasks.length > 0 ? Math.round((completed.length / myTasks.length) * 100) : 0;
      const lines = [
        `Agent: ${agent.name} (${agent.id})`,
        `Tasks: ${myTasks.length} total, ${pending.length} pending, ${inProgress.length} active, ${completed.length} done (${rate}%)`,
      ];
      if (pending.length > 0) {
        lines.push(`\nPending:`);
        for (const t of pending.slice(0, 10)) lines.push(`  [${t.priority}] ${t.id.slice(0, 8)} | ${t.title}`);
      }
      if (inProgress.length > 0) {
        lines.push(`\nIn Progress:`);
        for (const t of inProgress) lines.push(`  ${t.id.slice(0, 8)} | ${t.title}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);

// get_org_chart — org hierarchy
server.tool(
  "get_org_chart",
  "Get agent org chart — who reports to who.",
  {},
  async () => {
    try {
      const { getOrgChart } = await import("../db/agents.js");
      const tree = getOrgChart();
      function render(nodes: any[], indent = 0): string {
        return nodes.map(n => {
          const prefix = "  ".repeat(indent);
          const role = n.agent.role ? ` (${n.agent.role})` : "";
          const line = `${prefix}${n.agent.name}${role} [${n.agent.id}]`;
          const children = n.reports.length > 0 ? "\n" + render(n.reports, indent + 1) : "";
          return line + children;
        }).join("\n");
      }
      const text = tree.length > 0 ? render(tree) : "No agents registered.";
      return { content: [{ type: "text" as const, text }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);

// set_reports_to — set agent hierarchy
server.tool(
  "set_reports_to",
  "Set who an agent reports to in the org chart.",
  {
    agent_name: z.string(),
    manager_name: z.string().optional(),
  },
  async ({ agent_name, manager_name }) => {
    try {
      const agent = getAgentByName(agent_name);
      if (!agent) return { content: [{ type: "text" as const, text: `Agent not found: ${agent_name}` }], isError: true };
      let managerId: string | null = null;
      if (manager_name) {
        const manager = getAgentByName(manager_name);
        if (!manager) return { content: [{ type: "text" as const, text: `Manager not found: ${manager_name}` }], isError: true };
        managerId = manager.id;
      }
      const { updateAgent } = await import("../db/agents.js");
      updateAgent(agent.id, { reports_to: managerId });
      const result = managerId ? `${agent_name} now reports to ${manager_name}` : `${agent_name} reports to no one (top-level)`;
      return { content: [{ type: "text" as const, text: result }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);

// === META TOOLS ===

// search_tools
server.tool(
  "search_tools",
  "List tool names matching a query.",
  { query: z.string().optional() },
  async ({ query }) => {
    const all = [
      "create_task","list_tasks","get_task","update_task","delete_task",
      "start_task","complete_task","lock_task","unlock_task","approve_task",
      "add_dependency","remove_dependency","add_comment",
      "create_project","list_projects",
      "create_plan","list_plans","get_plan","update_plan","delete_plan",
      "register_agent","list_agents","get_agent","get_my_tasks",
      "create_task_list","list_task_lists","get_task_list","update_task_list","delete_task_list",
      "search_tasks","sync",
      "get_task_history","get_recent_activity",
      "create_webhook","list_webhooks","delete_webhook",
      "create_template","list_templates","create_task_from_template","delete_template",
      "search_tools","describe_tools",
    ];
    const q = query?.toLowerCase();
    const matches = q ? all.filter(n => n.includes(q)) : all;
    return { content: [{ type: "text" as const, text: matches.join(", ") }] };
  },
);

// describe_tools
server.tool(
  "describe_tools",
  "Get descriptions for specific tools by name.",
  { names: z.array(z.string()) },
  async ({ names }) => {
    const descriptions: Record<string, string> = {
      create_task: "Create a task. Params: title(req), description, priority, project_id, plan_id, tags, assigned_to, estimated_minutes, requires_approval",
      list_tasks: "List tasks. Params: status, priority, project_id, plan_id, assigned_to, tags, limit",
      get_task: "Get full task details. Params: id",
      update_task: "Update task fields. Params: id, version(req), title, description, status, priority, tags, assigned_to, due_at",
      delete_task: "Delete a task. Params: id",
      start_task: "Claim, lock, and start a task. Params: id",
      complete_task: "Mark task completed. Params: id, agent_id",
      approve_task: "Approve task requiring approval. Params: id, agent_id",
      create_plan: "Create a plan. Params: name, description, project_id, task_list_id, agent_id, status",
      list_plans: "List plans. Params: project_id",
      get_plan: "Get plan with tasks. Params: id",
      search_tasks: "Full-text search tasks. Params: query, project_id, task_list_id",
      get_my_tasks: "Get your tasks and stats. Params: agent_name",
      get_task_history: "Get task audit log. Params: task_id",
      get_recent_activity: "Recent changes across all tasks. Params: limit",
      create_template: "Create task template. Params: name, title_pattern, description, priority, tags",
      create_task_from_template: "Create task from template. Params: template_id, title, priority, assigned_to",
    };
    const result = names.map(n => `${n}: ${descriptions[n] || "See tool schema"}`).join("\n");
    return { content: [{ type: "text" as const, text: result }] };
  },
);

// === RESOURCES ===

// todos://tasks - All active tasks
server.resource(
  "tasks",
  "todos://tasks",
  { description: "All active tasks", mimeType: "application/json" },
  async () => {
    const tasks = listTasks({ status: ["pending", "in_progress"] });
    return { contents: [{ uri: "todos://tasks", text: JSON.stringify(tasks, null, 2), mimeType: "application/json" }] };
  },
);

// todos://projects - All projects
server.resource(
  "projects",
  "todos://projects",
  { description: "All registered projects", mimeType: "application/json" },
  async () => {
    const projects = listProjects();
    return { contents: [{ uri: "todos://projects", text: JSON.stringify(projects, null, 2), mimeType: "application/json" }] };
  },
);

// todos://agents - All registered agents
server.resource(
  "agents",
  "todos://agents",
  { description: "All registered agents", mimeType: "application/json" },
  async () => {
    const agents = listAgents();
    return { contents: [{ uri: "todos://agents", text: JSON.stringify(agents, null, 2), mimeType: "application/json" }] };
  },
);

// todos://task-lists - All task lists
server.resource(
  "task-lists",
  "todos://task-lists",
  { description: "All task lists", mimeType: "application/json" },
  async () => {
    const lists = listTaskLists();
    return { contents: [{ uri: "todos://task-lists", text: JSON.stringify(lists, null, 2), mimeType: "application/json" }] };
  },
);

// === START SERVER ===

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
