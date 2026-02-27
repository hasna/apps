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
} from "../types/index.js";
import type { Task } from "../types/index.js";

const server = new McpServer({
  name: "todos",
  version: "0.1.0",
});

function formatError(error: unknown): string {
  if (error instanceof VersionConflictError) return `Version conflict: ${error.message}`;
  if (error instanceof TaskNotFoundError) return `Not found: ${error.message}`;
  if (error instanceof PlanNotFoundError) return `Not found: ${error.message}`;
  if (error instanceof LockError) return `Lock error: ${error.message}`;
  if (error instanceof DependencyCycleError) return `Dependency cycle: ${error.message}`;
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
    tags: z.array(z.string()).optional().describe("Task tags"),
    metadata: z.record(z.unknown()).optional().describe("Arbitrary metadata"),
  },
  async (params) => {
    try {
      const resolved = { ...params };
      if (resolved.project_id) resolved.project_id = resolveId(resolved.project_id, "projects");
      if (resolved.parent_id) resolved.parent_id = resolveId(resolved.parent_id);
      if (resolved.plan_id) resolved.plan_id = resolveId(resolved.plan_id, "plans");
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
  },
  async (params) => {
    try {
      const resolved = { ...params };
      if (resolved.project_id) resolved.project_id = resolveId(resolved.project_id, "projects");
      if (resolved.plan_id) resolved.plan_id = resolveId(resolved.plan_id, "plans");
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
  },
  async (params) => {
    try {
      const resolved = { ...params };
      if (resolved.project_id) resolved.project_id = resolveId(resolved.project_id, "projects");
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
  },
  async ({ id, ...rest }) => {
    try {
      const resolvedId = resolveId(id, "plans");
      const plan = updatePlan(resolvedId, rest);
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
  },
  async ({ query, project_id }) => {
    try {
      const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
      const tasks = searchTasks(query, resolvedProjectId);
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

// === START SERVER ===

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
