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

function formatTask(task: Task): string {
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
    title: z.string().describe("Task title"),
    description: z.string().optional().describe("Task description"),
    project_id: z.string().optional().describe("Project ID"),
    parent_id: z.string().optional().describe("Parent task ID (for subtasks)"),
    priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Task priority"),
    status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional().describe("Initial status"),
    agent_id: z.string().optional().describe("Creator agent ID"),
    assigned_to: z.string().optional().describe("Assigned agent ID"),
    session_id: z.string().optional().describe("Session ID"),
    working_dir: z.string().optional().describe("Working directory context"),
    plan_id: z.string().optional().describe("Plan ID to assign task to"),
    task_list_id: z.string().optional().describe("Task list ID to assign task to"),
    tags: z.array(z.string()).optional().describe("Task tags"),
    metadata: z.record(z.unknown()).optional().describe("Arbitrary metadata"),
    estimated_minutes: z.number().optional().describe("Estimated time in minutes"),
    requires_approval: z.boolean().optional().describe("Require approval before completion"),
  },
  async (params) => {
    try {
      const resolved = { ...params };
      if (resolved.project_id) resolved.project_id = resolveId(resolved.project_id, "projects");
      if (resolved.parent_id) resolved.parent_id = resolveId(resolved.parent_id);
      if (resolved.plan_id) resolved.plan_id = resolveId(resolved.plan_id, "plans");
      if (resolved.task_list_id) resolved.task_list_id = resolveId(resolved.task_list_id, "task_lists");
      const task = createTask(resolved);
      return { content: [{ type: "text" as const, text: `Task created:\n${formatTask(task)}` }] };
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
    project_id: z.string().optional().describe("Filter by project"),
    status: z.union([
      z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]),
      z.array(z.enum(["pending", "in_progress", "completed", "failed", "cancelled"])),
    ]).optional().describe("Filter by status"),
    priority: z.union([
      z.enum(["low", "medium", "high", "critical"]),
      z.array(z.enum(["low", "medium", "high", "critical"])),
    ]).optional().describe("Filter by priority"),
    assigned_to: z.string().optional().describe("Filter by assigned agent"),
    tags: z.array(z.string()).optional().describe("Filter by tags (any match)"),
    plan_id: z.string().optional().describe("Filter by plan"),
    task_list_id: z.string().optional().describe("Filter by task list"),
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
  "Get full task details including dependencies, subtasks, and comments",
  {
    id: z.string().describe("Task ID (full or partial)"),
  },
  async ({ id }) => {
    try {
      const resolvedId = resolveId(id);
      const task = getTaskWithRelations(resolvedId);
      if (!task) return { content: [{ type: "text" as const, text: `Task not found: ${id}` }], isError: true };

      const parts = [formatTask(task)];

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
  "Update task fields (requires version for optimistic locking)",
  {
    id: z.string().describe("Task ID (full or partial)"),
    version: z.number().describe("Current version (for optimistic locking)"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional().describe("New status"),
    priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("New priority"),
    assigned_to: z.string().optional().describe("Assign to agent"),
    tags: z.array(z.string()).optional().describe("New tags"),
    metadata: z.record(z.unknown()).optional().describe("New metadata"),
    plan_id: z.string().optional().describe("Plan ID to assign task to"),
    task_list_id: z.string().optional().describe("Task list ID"),
  },
  async ({ id, ...rest }) => {
    try {
      const resolvedId = resolveId(id);
      const task = updateTask(resolvedId, rest);
      return { content: [{ type: "text" as const, text: `Task updated:\n${formatTask(task)}` }] };
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
    id: z.string().describe("Task ID (full or partial)"),
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
  "Claim a task, lock it, and set status to in_progress",
  {
    id: z.string().describe("Task ID (full or partial)"),
    agent_id: z.string().describe("Agent claiming the task"),
  },
  async ({ id, agent_id }) => {
    try {
      const resolvedId = resolveId(id);
      const task = startTask(resolvedId, agent_id);
      return { content: [{ type: "text" as const, text: `Task started:\n${formatTask(task)}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);

// 7. complete_task
server.tool(
  "complete_task",
  "Mark a task as completed and release lock",
  {
    id: z.string().describe("Task ID (full or partial)"),
    agent_id: z.string().optional().describe("Agent completing the task"),
  },
  async ({ id, agent_id }) => {
    try {
      const resolvedId = resolveId(id);
      const task = completeTask(resolvedId, agent_id);
      return { content: [{ type: "text" as const, text: `Task completed:\n${formatTask(task)}` }] };
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
    id: z.string().describe("Task ID (full or partial)"),
    agent_id: z.string().describe("Agent acquiring lock"),
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
    id: z.string().describe("Task ID (full or partial)"),
    agent_id: z.string().optional().describe("Agent releasing lock (omit to force)"),
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
  "Add a dependency between tasks (task_id depends on depends_on)",
  {
    task_id: z.string().describe("Task that depends on another"),
    depends_on: z.string().describe("Task that must complete first"),
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
    task_id: z.string().describe("Task ID"),
    depends_on: z.string().describe("Dependency to remove"),
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
    task_id: z.string().describe("Task ID (full or partial)"),
    content: z.string().describe("Comment content"),
    agent_id: z.string().optional().describe("Agent adding comment"),
    session_id: z.string().optional().describe("Session ID"),
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
    name: z.string().describe("Project name"),
    path: z.string().describe("Absolute path to project"),
    description: z.string().optional().describe("Project description"),
    task_list_id: z.string().optional().describe("Custom task list ID for Claude Code sync (defaults to todos-<slugified-name>)"),
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
    name: z.string().describe("Plan name"),
    project_id: z.string().optional().describe("Project ID"),
    description: z.string().optional().describe("Plan description"),
    status: z.enum(["active", "completed", "archived"]).optional().describe("Plan status"),
    task_list_id: z.string().optional().describe("Task list ID"),
    agent_id: z.string().optional().describe("Owner agent ID"),
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
    project_id: z.string().optional().describe("Filter by project"),
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
    id: z.string().describe("Plan ID (full or partial)"),
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
    id: z.string().describe("Plan ID (full or partial)"),
    name: z.string().optional().describe("New name"),
    description: z.string().optional().describe("New description"),
    status: z.enum(["active", "completed", "archived"]).optional().describe("New status"),
    task_list_id: z.string().optional().describe("Task list ID"),
    agent_id: z.string().optional().describe("Owner agent ID"),
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
    id: z.string().describe("Plan ID (full or partial)"),
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
  "Full-text search across task titles, descriptions, and tags",
  {
    query: z.string().describe("Search query"),
    project_id: z.string().optional().describe("Limit to project"),
    task_list_id: z.string().optional().describe("Filter by task list"),
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
  "Sync tasks with an agent task list (Claude uses native task list; others use JSON lists).",
  {
    task_list_id: z.string().optional().describe("Task list ID (required for Claude)"),
    agent: z.string().optional().describe("Agent/provider name (default: claude)"),
    all_agents: z.boolean().optional().describe("Sync across all configured agents"),
    project_id: z.string().optional().describe("Project ID — its task_list_id will be used for Claude if task_list_id is not provided"),
    direction: z.enum(["push", "pull", "both"]).optional().describe("Sync direction: push (SQLite->agent), pull (agent->SQLite), or both (default)"),
    prefer: z.enum(["local", "remote"]).optional().describe("Conflict strategy"),
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
  "Register an agent and get a short UUID. Idempotent: same name returns existing agent.",
  {
    name: z.string().describe("Agent name"),
    description: z.string().optional().describe("Agent description"),
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
    id: z.string().optional().describe("Agent ID"),
    name: z.string().optional().describe("Agent name"),
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
    name: z.string().describe("Task list name"),
    slug: z.string().optional().describe("URL-friendly slug (auto-generated from name if omitted)"),
    project_id: z.string().optional().describe("Project ID to associate with"),
    description: z.string().optional().describe("Task list description"),
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
    project_id: z.string().optional().describe("Filter by project"),
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
    id: z.string().describe("Task list ID (full or partial)"),
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
    id: z.string().describe("Task list ID (full or partial)"),
    name: z.string().optional().describe("New name"),
    description: z.string().optional().describe("New description"),
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
  "Delete a task list. Tasks in this list keep their data but lose their list association.",
  {
    id: z.string().describe("Task list ID (full or partial)"),
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
  "Get change history for a task (audit log)",
  {
    task_id: z.string().describe("Task ID (full or partial)"),
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
  "Get recent task changes across all tasks (audit log)",
  {
    limit: z.number().optional().describe("Max entries (default 50)"),
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
  "Register a webhook URL to receive task change notifications",
  {
    url: z.string().describe("Webhook URL"),
    events: z.array(z.string()).optional().describe("Event types to subscribe to (empty = all)"),
    secret: z.string().optional().describe("HMAC secret for signature verification"),
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
    id: z.string().describe("Webhook ID"),
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
  "Create a reusable task template",
  {
    name: z.string().describe("Template name"),
    title_pattern: z.string().describe("Title pattern for tasks created from this template"),
    description: z.string().optional().describe("Default description"),
    priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Default priority"),
    tags: z.array(z.string()).optional().describe("Default tags"),
    project_id: z.string().optional().describe("Default project"),
    plan_id: z.string().optional().describe("Default plan"),
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
  "Create a task from a template with optional overrides",
  {
    template_id: z.string().describe("Template ID"),
    title: z.string().optional().describe("Override title"),
    description: z.string().optional().describe("Override description"),
    priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Override priority"),
    assigned_to: z.string().optional().describe("Assign to agent"),
    project_id: z.string().optional().describe("Override project"),
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
  { id: z.string().describe("Template ID") },
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
  "Approve a task that requires approval before completion",
  {
    id: z.string().describe("Task ID (full or partial)"),
    agent_id: z.string().optional().describe("Agent approving the task"),
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
  "Get your assigned tasks and stats. Auto-registers if needed.",
  {
    agent_name: z.string().describe("Your agent name"),
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
