#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createTask,
  getTask,
  getTaskWithRelations,
  listTasks,
  countTasks,
  updateTask,
  deleteTask,
  startTask,
  completeTask,
  lockTask,
  unlockTask,
  addDependency,
  removeDependency,
  bulkUpdateTasks,
  bulkCreateTasks,
  cloneTask,
  getTaskStats,
  getTaskGraph,
  moveTask,
  getNextTask,
  claimNextTask,
  stealTask,
  claimOrSteal,
  getActiveWork,
  getTasksChangedSince,
  failTask,
  getStaleTasks,
  getStatus,
  decomposeTasks,
  setTaskStatus,
  setTaskPriority,
  redistributeStaleTasks,
} from "../db/tasks.js";
import { addComment, logProgress } from "../db/comments.js";
import {
  createProject,
  getProject,
  listProjects,
  addProjectSource,
  removeProjectSource,
  listProjectSources,
} from "../db/projects.js";
import {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
} from "../db/plans.js";
import { registerAgent, isAgentConflict, releaseAgent, getAgent, getAgentByName, listAgents, updateAgent, updateAgentActivity, archiveAgent, unarchiveAgent, getAvailableNamesFromPool } from "../db/agents.js";
import { createTaskList, getTaskList, listTaskLists, updateTaskList, deleteTaskList } from "../db/task-lists.js";
import { searchTasks } from "../lib/search.js";
import { defaultSyncAgents, syncWithAgent, syncWithAgents } from "../lib/sync.js";
import { getAgentTaskListId, getAgentPoolForProject } from "../lib/config.js";
import { getDatabase, resolvePartialId } from "../db/database.js";
import {
  getChecklist,
  addChecklistItem,
  checkChecklistItem,
  updateChecklistItemText,
  removeChecklistItem,
} from "../db/checklists.js";
import {
  VersionConflictError,
  TaskNotFoundError,
  ProjectNotFoundError,
  LockError,
  DependencyCycleError,
  PlanNotFoundError,
  TaskListNotFoundError,
  AgentNotFoundError,
  CompletionGuardError,
} from "../types/index.js";
import type { Task } from "../types/index.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

function getMcpVersion(): string {
  try {
    const __dir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dir, "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version || "0.0.0";
  } catch { return "0.0.0"; }
}

const server = new McpServer({
  name: "todos",
  version: getMcpVersion(),
});

// === PROFILE FILTERING ===

const TODOS_PROFILE = (process.env["TODOS_PROFILE"] || "full").toLowerCase();

const MINIMAL_TOOLS = new Set([
  "claim_next_task", "complete_task", "fail_task", "get_status", "get_context",
  "get_task", "start_task", "add_comment", "get_next_task", "bootstrap",
  "get_tasks_changed_since", "heartbeat", "release_agent",
]);

const STANDARD_EXCLUDED = new Set([
  "rename_agent", "delete_agent", "unarchive_agent",
  "create_webhook", "list_webhooks", "delete_webhook",
  "create_template", "list_templates", "create_task_from_template", "delete_template",
  "approve_task",
]);

function shouldRegisterTool(name: string): boolean {
  if (TODOS_PROFILE === "minimal") return MINIMAL_TOOLS.has(name);
  if (TODOS_PROFILE === "standard") return !STANDARD_EXCLUDED.has(name);
  return true; // "full" or any unknown value = all tools
}

// === FOCUS MODE ===

interface AgentFocus {
  agent_id: string;
  project_id?: string;
  task_list_id?: string;
}

const agentFocusMap = new Map<string, AgentFocus>();

function getAgentFocus(agentId: string): AgentFocus | undefined {
  // Session focus takes priority
  const sessionFocus = agentFocusMap.get(agentId);
  if (sessionFocus) return sessionFocus;
  // Fall back to DB active_project_id
  try {
    const agent = getAgentByName(agentId) || getAgent(agentId);
    if (agent && (agent as any).active_project_id) {
      return { agent_id: agentId, project_id: (agent as any).active_project_id };
    }
  } catch {}
  return undefined;
}

export function applyFocus(params: Record<string, any>, agentId?: string): void {
  if (!agentId) return;
  if (params.project_id) return; // explicit param takes priority
  const focus = getAgentFocus(agentId);
  if (focus?.project_id) {
    params.project_id = focus.project_id;
  }
}

function formatError(error: unknown): string {
  if (error instanceof VersionConflictError) {
    return JSON.stringify({ code: VersionConflictError.code, message: error.message, suggestion: VersionConflictError.suggestion });
  }
  if (error instanceof TaskNotFoundError) {
    return JSON.stringify({ code: TaskNotFoundError.code, message: error.message, suggestion: TaskNotFoundError.suggestion });
  }
  if (error instanceof ProjectNotFoundError) {
    return JSON.stringify({ code: ProjectNotFoundError.code, message: error.message, suggestion: ProjectNotFoundError.suggestion });
  }
  if (error instanceof PlanNotFoundError) {
    return JSON.stringify({ code: PlanNotFoundError.code, message: error.message, suggestion: PlanNotFoundError.suggestion });
  }
  if (error instanceof TaskListNotFoundError) {
    return JSON.stringify({ code: TaskListNotFoundError.code, message: error.message, suggestion: TaskListNotFoundError.suggestion });
  }
  if (error instanceof LockError) {
    return JSON.stringify({ code: LockError.code, message: error.message, suggestion: LockError.suggestion });
  }
  if (error instanceof AgentNotFoundError) {
    return JSON.stringify({ code: AgentNotFoundError.code, message: error.message, suggestion: AgentNotFoundError.suggestion });
  }
  if (error instanceof DependencyCycleError) {
    return JSON.stringify({ code: DependencyCycleError.code, message: error.message, suggestion: DependencyCycleError.suggestion });
  }
  if (error instanceof CompletionGuardError) {
    const retry = error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {};
    return JSON.stringify({ code: CompletionGuardError.code, message: error.reason, suggestion: CompletionGuardError.suggestion, ...retry });
  }
  if (error instanceof Error) {
    const msg = error.message;
    // Wrap SQLite constraint errors with agent-friendly messages
    if (msg.includes("UNIQUE constraint failed: projects.path")) {
      const db = getDatabase();
      const existing = db.prepare("SELECT id, name FROM projects WHERE path = ?").get(msg.match(/'([^']+)'$/)?.[1] ?? "") as any;
      return JSON.stringify({ code: "DUPLICATE_PROJECT", message: `Project already exists at this path${existing ? ` (id: ${existing.id}, name: ${existing.name})` : ""}. Use list_projects to find it.`, suggestion: "Use list_projects or get_project to retrieve the existing project." });
    }
    if (msg.includes("UNIQUE constraint failed: projects.name")) {
      return JSON.stringify({ code: "DUPLICATE_PROJECT", message: "A project with this name already exists. Use a different name or list_projects to find the existing one.", suggestion: "Use list_projects to see existing projects." });
    }
    if (msg.includes("UNIQUE constraint failed")) {
      const table = msg.match(/UNIQUE constraint failed: (\w+)\./)?.[1] ?? "unknown";
      return JSON.stringify({ code: "DUPLICATE_ENTRY", message: `Duplicate entry in ${table}. The record already exists.`, suggestion: `Use the list or get endpoint for ${table} to find the existing record.` });
    }
    if (msg.includes("FOREIGN KEY constraint failed")) {
      return JSON.stringify({ code: "REFERENCE_ERROR", message: "Referenced record does not exist. Check that the ID is correct.", suggestion: "Verify the referenced ID exists before creating this record." });
    }
    return JSON.stringify({ code: "UNKNOWN_ERROR", message: msg });
  }
  return JSON.stringify({ code: "UNKNOWN_ERROR", message: String(error) });
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
  const recur = task.recurrence_rule ? ` [↻]` : "";
  return `${id} ${task.status.padEnd(11)} ${task.priority.padEnd(8)} ${task.title}${assigned}${lock}${recur}`;
}

/** Full multi-line task detail for get_task responses. */
function formatTaskDetail(task: Task, maxDescriptionChars?: number): string {
  const parts = [
    `ID: ${task.id}`,
    `Title: ${task.title}`,
    `Status: ${task.status}`,
    `Priority: ${task.priority}`,
  ];
  if (task.description) {
    const desc = maxDescriptionChars && task.description.length > maxDescriptionChars
      ? task.description.slice(0, maxDescriptionChars) + "…"
      : task.description;
    parts.push(`Description: ${desc}`);
  }
  if (task.assigned_to) parts.push(`Assigned to: ${task.assigned_to}`);
  if (task.agent_id) parts.push(`Agent: ${task.agent_id}`);
  if (task.locked_by) parts.push(`Locked by: ${task.locked_by}`);
  if (task.parent_id) parts.push(`Parent: ${task.parent_id}`);
  if (task.project_id) parts.push(`Project: ${task.project_id}`);
  if (task.plan_id) parts.push(`Plan: ${task.plan_id}`);
  if (task.tags.length > 0) parts.push(`Tags: ${task.tags.join(", ")}`);
  if (task.recurrence_rule) parts.push(`Recurrence: ${task.recurrence_rule}`);
  if (task.recurrence_parent_id) parts.push(`Recurrence parent: ${task.recurrence_parent_id}`);
  parts.push(`Version: ${task.version}`);
  parts.push(`Created: ${task.created_at}`);
  if (task.completed_at) parts.push(`Completed: ${task.completed_at}`);
  return parts.join("\n");
}

// === TOOLS ===

// 1. create_task
if (shouldRegisterTool("create_task")) {
server.tool(
  "create_task",
  "Create a new task. Requires agent_id — agent must be registered via register_agent first. The assigning agent's active project is auto-detected as assigned_from_project.",
  {
    title: z.string(),
    description: z.string().optional(),
    project_id: z.string().optional(),
    parent_id: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
    agent_id: z.string().describe("Required. Your registered agent ID or name. Use register_agent first if you haven't."),
    assigned_to: z.string().optional(),
    session_id: z.string().optional(),
    working_dir: z.string().optional(),
    plan_id: z.string().optional(),
    task_list_id: z.string().optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
    estimated_minutes: z.number().optional(),
    requires_approval: z.boolean().optional(),
    recurrence_rule: z.string().optional(),
    spawns_template_id: z.string().optional().describe("Template ID to auto-create as next task when this task is completed (pipeline/handoff chains)"),
    reason: z.string().optional().describe("Why this task exists — context for agents picking it up"),
    spawned_from_session: z.string().optional().describe("Session ID that created this task (for tracing task lineage)"),
    assigned_from_project: z.string().optional().describe("Override: project ID the assigning agent is working from. Auto-detected from agent focus if omitted."),
    task_type: z.string().optional().describe("Task type: bug, feature, chore, improvement, docs, test, security, or any custom string"),
  },
  async (params) => {
    try {
      // Enforce agent registration — agent must be signed in to create tasks
      if (!params.agent_id) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "AGENT_REQUIRED", message: "agent_id is required to create tasks. Register your agent first using register_agent." }) }], isError: true };
      }

      const resolved = { ...params } as Record<string, unknown>;
      if (resolved["project_id"]) resolved["project_id"] = resolveId(resolved["project_id"] as string, "projects");
      if (resolved["parent_id"]) resolved["parent_id"] = resolveId(resolved["parent_id"] as string);
      if (resolved["plan_id"]) resolved["plan_id"] = resolveId(resolved["plan_id"] as string, "plans");
      if (resolved["task_list_id"]) resolved["task_list_id"] = resolveId(resolved["task_list_id"] as string, "task_lists");

      // Auto-detect assigned_from_project from the calling agent's active focus/project
      if (!resolved["assigned_from_project"]) {
        const focus = getAgentFocus(params.agent_id);
        if (focus?.project_id) {
          resolved["assigned_from_project"] = focus.project_id;
        }
      }

      const task = createTask(resolved as unknown as Parameters<typeof createTask>[0]);
      return { content: [{ type: "text" as const, text: `created: ${formatTask(task)}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// 2. list_tasks
if (shouldRegisterTool("list_tasks")) {
server.tool(
  "list_tasks",
  "List tasks with optional filters and pagination. Default limit is 50 — use offset to page through results.",
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
    has_recurrence: z.boolean().optional(),
    due_today: z.boolean().optional(),
    overdue: z.boolean().optional(),
    task_type: z.union([z.string(), z.array(z.string())]).optional().describe("Filter by task type: bug, feature, chore, improvement, docs, test, security, or custom"),
    limit: z.number().optional(),
    offset: z.number().optional(),
    summary_only: z.boolean().optional().describe("When true, return only id, short_id, title, status, priority — minimal tokens for navigation"),
    cursor: z.string().optional().describe("Opaque cursor from a prior response for stable pagination. Use next_cursor from the previous page. Mutually exclusive with offset."),
  },
  async (params) => {
    try {
      const { due_today, overdue, summary_only, ...rest } = params as any;
      const resolved = { ...rest };
      // Default limit of 50 to prevent context overflow when there are many tasks
      if (resolved.limit === undefined) resolved.limit = 50;
      if (resolved.project_id) resolved.project_id = resolveId(resolved.project_id, "projects");
      if (resolved.plan_id) resolved.plan_id = resolveId(resolved.plan_id, "plans");
      if (resolved.task_list_id) resolved.task_list_id = resolveId(resolved.task_list_id, "task_lists");
      let tasks = listTasks(resolved);
      // Filter by due_today / overdue after fetching
      const today = new Date(); today.setHours(23, 59, 59, 999);
      const todayStr = today.toISOString();
      const nowStr = new Date().toISOString();
      if (due_today) tasks = tasks.filter(t => t.due_at && t.due_at <= todayStr);
      if (overdue) tasks = tasks.filter(t => t.due_at && t.due_at < nowStr && t.status !== "completed");
      const { limit: _limit, offset: _offset, ...countFilter } = resolved;
      const total = countTasks(countFilter);
      if (tasks.length === 0) {
        return { content: [{ type: "text" as const, text: total > 0 ? `No tasks in this page (total: ${total}).` : "No tasks found." }] };
      }
      const text = tasks.map((t) => {
        if (summary_only) {
          return `${t.short_id || t.id.slice(0, 8)} [${t.status}] ${t.priority} ${t.title}`;
        }
        const lock = t.locked_by ? ` [locked by ${t.locked_by}]` : "";
        const assigned = t.assigned_to ? ` -> ${t.assigned_to}` : "";
        const due = t.due_at ? ` due:${t.due_at.slice(0, 10)}` : "";
        const recur = t.recurrence_rule ? " [↻]" : "";
        return `[${t.status}] ${t.id.slice(0, 8)} | ${t.priority} | ${t.title}${assigned}${lock}${due}${recur}`;
      }).join("\n");
      const currentOffset = resolved.offset || 0;
      const hasMore = total > (resolved.cursor ? tasks.length : currentOffset + tasks.length);
      let paginationNote = `\n(showing ${tasks.length} of ${total}`;
      if (hasMore) {
        if (resolved.cursor || tasks.length > 0) {
          // Emit next_cursor from last task's sort key
          const last = tasks[tasks.length - 1]!;
          const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 }[last.priority] ?? 3;
          const cursorPayload = Buffer.from(JSON.stringify({ p: priorityRank, c: last.created_at, i: last.id })).toString("base64");
          paginationNote += ` — next_cursor: ${cursorPayload}`;
        } else {
          paginationNote += ` — use offset: ${currentOffset + tasks.length} to get next page`;
        }
      }
      paginationNote += ")";
      return { content: [{ type: "text" as const, text: `${tasks.length} task(s):\n${text}${paginationNote}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// 3. get_task
if (shouldRegisterTool("get_task")) {
server.tool(
  "get_task",
  "Get full task details with subtasks, deps, and comments.",
  {
    id: z.string(),
    max_description_chars: z.number().optional().describe("Truncate description to this many characters (default: unlimited). Use 300-500 for quick checks."),
  },
  async ({ id, max_description_chars }) => {
    try {
      const resolvedId = resolveId(id);
      const task = getTaskWithRelations(resolvedId);
      if (!task) return { content: [{ type: "text" as const, text: `Task not found: ${id}` }], isError: true };

      const parts = [formatTaskDetail(task, max_description_chars)];

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
      if (task.checklist.length > 0) {
        const done = task.checklist.filter(i => i.checked).length;
        parts.push(`\nChecklist (${done}/${task.checklist.length}):`);
        for (const item of task.checklist) {
          parts.push(`  ${item.position + 1}. [${item.checked ? "x" : " "}] ${item.text}  (${item.id.slice(0, 8)})`);
        }
      }

      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// 4. update_task
if (shouldRegisterTool("update_task")) {
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
    task_type: z.string().nullable().optional().describe("Task type: bug, feature, chore, improvement, docs, test, security, or custom. null to clear."),
  },
  async ({ id, ...rest }) => {
    try {
      const resolvedId = resolveId(id);
      const resolved = { ...rest } as Record<string, unknown>;
      if (resolved.task_list_id) resolved.task_list_id = resolveId(resolved.task_list_id as string, "task_lists");
      if (resolved.plan_id) resolved.plan_id = resolveId(resolved.plan_id as string, "plans");
      const task = updateTask(resolvedId, resolved as unknown as Parameters<typeof updateTask>[1]);
      return { content: [{ type: "text" as const, text: `updated: ${formatTask(task)}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// 5. delete_task
if (shouldRegisterTool("delete_task")) {
server.tool(
  "delete_task",
  "Delete a task permanently. Subtasks cascade-deleted.",
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
}

// 6. start_task
if (shouldRegisterTool("start_task")) {
server.tool(
  "start_task",
  "Claim, lock, and set task to in_progress.",
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
}

// 7. complete_task
if (shouldRegisterTool("complete_task")) {
server.tool(
  "complete_task",
  "Complete a task. For recurring tasks, auto-spawns next instance.",
  {
    id: z.string(),
    agent_id: z.string().optional(),
    skip_recurrence: z.boolean().optional(),
    files_changed: z.array(z.string()).optional().describe("List of files changed as part of completing this task"),
    test_results: z.string().optional().describe("Summary of test results"),
    commit_hash: z.string().optional().describe("Git commit hash associated with this completion"),
    notes: z.string().optional().describe("Notes about the completion"),
    attachment_ids: z.array(z.string()).optional().describe("IDs of attachments uploaded via @hasna/attachments to link as evidence"),
    confidence: z.number().min(0).max(1).optional().describe("Agent's confidence 0.0-1.0 that the task is fully complete. Default: 1.0. Low confidence (<0.7) is flagged as a signal for review."),
  },
  async ({ id, agent_id, skip_recurrence, files_changed, test_results, commit_hash, notes, attachment_ids, confidence }) => {
    try {
      const resolvedId = resolveId(id);
      const evidence = (files_changed || test_results || commit_hash || notes || attachment_ids)
        ? { files_changed, test_results, commit_hash, notes, attachment_ids }
        : undefined;
      const task = completeTask(resolvedId, agent_id, undefined, { skip_recurrence, confidence, ...evidence });
      // Auto-link commit SHA if provided
      if (commit_hash) {
        try {
          const { linkTaskToCommit } = require("../db/task-commits.js") as any;
          linkTaskToCommit({ task_id: resolvedId, sha: commit_hash, files_changed });
        } catch { /* non-fatal */ }
      }
      let text = `completed: ${formatTask(task)}`;
      if (task.metadata._next_recurrence) {
        const next = task.metadata._next_recurrence as { id: string; short_id?: string; due_at?: string };
        text += `\nnext: ${next.short_id || next.id.slice(0, 8)} due ${next.due_at}`;
      }
      return { content: [{ type: "text" as const, text }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// 8. lock_task
if (shouldRegisterTool("lock_task")) {
server.tool(
  "lock_task",
  "Acquire exclusive lock. Expires after 30 min. Idempotent per agent.",
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
}

// 9. unlock_task
if (shouldRegisterTool("unlock_task")) {
server.tool(
  "unlock_task",
  "Release exclusive lock on a task.",
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
}

// 10. add_dependency
if (shouldRegisterTool("add_dependency")) {
server.tool(
  "add_dependency",
  "Add a dependency. Prevents cycles via BFS detection.",
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
}

// 11. remove_dependency
if (shouldRegisterTool("remove_dependency")) {
server.tool(
  "remove_dependency",
  "Remove a dependency link between two tasks.",
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
}

// 12. add_comment
if (shouldRegisterTool("add_comment")) {
server.tool(
  "add_comment",
  "Add a comment or note to a task. Comments are append-only.",
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
}

// 12b. log_progress
if (shouldRegisterTool("log_progress")) {
server.tool(
  "log_progress",
  "Record intermediate work progress on a task with optional percent complete.",
  {
    task_id: z.string(),
    message: z.string(),
    pct_complete: z.number().min(0).max(100).optional(),
    agent_id: z.string().optional(),
  },
  async ({ task_id, message, pct_complete, agent_id }) => {
    try {
      const resolvedId = resolveId(task_id);
      const comment = logProgress(resolvedId, message, pct_complete, agent_id);
      const pct = pct_complete !== undefined ? ` (${pct_complete}%)` : "";
      return { content: [{ type: "text" as const, text: `progress: ${comment.id.slice(0, 8)}${pct} — ${message}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// 13. list_projects
if (shouldRegisterTool("list_projects")) {
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
}

// 14. create_project
if (shouldRegisterTool("create_project")) {
server.tool(
  "create_project",
  "Register a new project with auto-generated task prefix.",
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
}

// add_project_source
if (shouldRegisterTool("add_project_source")) {
server.tool(
  "add_project_source",
  "Add a data source to a project (S3 bucket, Google Drive folder, local path, GitHub repo, Notion page, etc.). Sources are revealed to agents when they load the project.",
  {
    project_id: z.string().describe("Project ID"),
    type: z.string().describe("Source type: 's3', 'gdrive', 'local', 'github', 'notion', 'http', or any custom label"),
    name: z.string().describe("Human-readable label for this source"),
    uri: z.string().describe("The source URI (bucket path, folder URL, local path, repo URL, etc.)"),
    description: z.string().optional().describe("What this source contains or how agents should use it"),
    metadata: z.record(z.unknown()).optional().describe("Extra config (e.g. region, access role, subfolder)"),
  },
  async (params) => {
    try {
      const resolvedProjectId = resolveId(params.project_id, "projects");
      const source = addProjectSource({ ...params, project_id: resolvedProjectId });
      return {
        content: [{
          type: "text" as const,
          text: `Source added: ${source.id.slice(0, 8)} | [${source.type}] ${source.name} → ${source.uri}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// remove_project_source
if (shouldRegisterTool("remove_project_source")) {
server.tool(
  "remove_project_source",
  "Remove a data source from a project by source ID.",
  {
    source_id: z.string().describe("Source ID to remove"),
  },
  async ({ source_id }) => {
    try {
      const db = getDatabase();
      const row = db.query("SELECT * FROM project_sources WHERE id LIKE ?").get(`${source_id}%`) as { id: string; name: string } | null;
      if (!row) return { content: [{ type: "text" as const, text: `Source not found: ${source_id}` }], isError: true };
      removeProjectSource(row.id);
      return { content: [{ type: "text" as const, text: `Source removed: ${row.name}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// list_project_sources
if (shouldRegisterTool("list_project_sources")) {
server.tool(
  "list_project_sources",
  "List all data sources attached to a project.",
  {
    project_id: z.string().describe("Project ID"),
  },
  async ({ project_id }) => {
    try {
      const resolvedId = resolveId(project_id, "projects");
      const sources = listProjectSources(resolvedId);
      if (sources.length === 0) {
        return { content: [{ type: "text" as const, text: "No sources configured for this project." }] };
      }
      const lines = sources.map(s =>
        `${s.id.slice(0, 8)} | [${s.type}] ${s.name} → ${s.uri}${s.description ? `\n  ${s.description}` : ""}`
      );
      return { content: [{ type: "text" as const, text: `${sources.length} source(s):\n${lines.join("\n")}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// add_checklist_item
if (shouldRegisterTool("add_checklist_item")) {
server.tool(
  "add_checklist_item",
  "Add a checklist item to a task. Items are numbered and individually checkable.",
  {
    task_id: z.string().describe("Task ID"),
    text: z.string().describe("Checklist item text"),
    position: z.number().optional().describe("Position (0-based). Appended to end if omitted."),
  },
  async ({ task_id, text, position }) => {
    try {
      const resolvedId = resolveId(task_id, "tasks");
      const item = addChecklistItem({ task_id: resolvedId, text, position });
      return {
        content: [{
          type: "text" as const,
          text: `Item added: ${item.position + 1}. [ ] ${item.text}  (${item.id.slice(0, 8)})`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// check_checklist_item
if (shouldRegisterTool("check_checklist_item")) {
server.tool(
  "check_checklist_item",
  "Mark a checklist item as checked or unchecked.",
  {
    item_id: z.string().describe("Checklist item ID or prefix"),
    checked: z.boolean().describe("true to check, false to uncheck"),
  },
  async ({ item_id, checked }) => {
    try {
      const db = getDatabase();
      const row = db.query("SELECT id FROM task_checklists WHERE id LIKE ?").get(`${item_id}%`) as { id: string } | null;
      if (!row) return { content: [{ type: "text" as const, text: `Checklist item not found: ${item_id}` }], isError: true };
      const item = checkChecklistItem(row.id, checked);
      if (!item) return { content: [{ type: "text" as const, text: "Update failed" }], isError: true };
      return {
        content: [{
          type: "text" as const,
          text: `${item.position + 1}. [${item.checked ? "x" : " "}] ${item.text}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// update_checklist_item
if (shouldRegisterTool("update_checklist_item")) {
server.tool(
  "update_checklist_item",
  "Update the text of a checklist item.",
  {
    item_id: z.string().describe("Checklist item ID or prefix"),
    text: z.string().describe("New text"),
  },
  async ({ item_id, text }) => {
    try {
      const db = getDatabase();
      const row = db.query("SELECT id FROM task_checklists WHERE id LIKE ?").get(`${item_id}%`) as { id: string } | null;
      if (!row) return { content: [{ type: "text" as const, text: `Checklist item not found: ${item_id}` }], isError: true };
      const item = updateChecklistItemText(row.id, text);
      if (!item) return { content: [{ type: "text" as const, text: "Update failed" }], isError: true };
      return {
        content: [{
          type: "text" as const,
          text: `Updated: ${item.position + 1}. [${item.checked ? "x" : " "}] ${item.text}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// remove_checklist_item
if (shouldRegisterTool("remove_checklist_item")) {
server.tool(
  "remove_checklist_item",
  "Remove a checklist item from a task.",
  {
    item_id: z.string().describe("Checklist item ID or prefix"),
  },
  async ({ item_id }) => {
    try {
      const db = getDatabase();
      const row = db.query("SELECT id, text FROM task_checklists WHERE id LIKE ?").get(`${item_id}%`) as { id: string; text: string } | null;
      if (!row) return { content: [{ type: "text" as const, text: `Checklist item not found: ${item_id}` }], isError: true };
      removeChecklistItem(row.id);
      return { content: [{ type: "text" as const, text: `Removed: ${row.text}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// get_checklist
if (shouldRegisterTool("get_checklist")) {
server.tool(
  "get_checklist",
  "Get all checklist items for a task with progress summary.",
  {
    task_id: z.string().describe("Task ID"),
  },
  async ({ task_id }) => {
    try {
      const resolvedId = resolveId(task_id, "tasks");
      const items = getChecklist(resolvedId);
      if (items.length === 0) {
        return { content: [{ type: "text" as const, text: "No checklist items." }] };
      }
      const done = items.filter(i => i.checked).length;
      const lines = [`Checklist (${done}/${items.length} done):`];
      for (const item of items) {
        lines.push(`  ${item.position + 1}. [${item.checked ? "x" : " "}] ${item.text}  (${item.id.slice(0, 8)})`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// create_plan
if (shouldRegisterTool("create_plan")) {
server.tool(
  "create_plan",
  "Create a plan to group related tasks.",
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
}

// list_plans
if (shouldRegisterTool("list_plans")) {
server.tool(
  "list_plans",
  "List all plans, optionally filtered by project.",
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
}

// get_plan
if (shouldRegisterTool("get_plan")) {
server.tool(
  "get_plan",
  "Get plan details including status and timestamps.",
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
}

// update_plan
if (shouldRegisterTool("update_plan")) {
server.tool(
  "update_plan",
  "Update plan fields (name, description, status).",
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
}

// delete_plan
if (shouldRegisterTool("delete_plan")) {
server.tool(
  "delete_plan",
  "Delete a plan. Tasks in the plan are orphaned (not deleted).",
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
}

// 15. search_tasks
if (shouldRegisterTool("search_tasks")) {
server.tool(
  "search_tasks",
  "Full-text search across tasks with filters.",
  {
    query: z.string(),
    project_id: z.string().optional(),
    task_list_id: z.string().optional(),
    status: z.union([
      z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]),
      z.array(z.enum(["pending", "in_progress", "completed", "failed", "cancelled"])),
    ]).optional(),
    priority: z.union([
      z.enum(["low", "medium", "high", "critical"]),
      z.array(z.enum(["low", "medium", "high", "critical"])),
    ]).optional(),
    assigned_to: z.string().optional(),
    agent_id: z.string().optional(),
    created_after: z.string().optional(),
    updated_after: z.string().optional(),
    has_dependencies: z.boolean().optional(),
    is_blocked: z.boolean().optional(),
  },
  async ({ query, project_id, task_list_id, ...filters }) => {
    try {
      const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
      const resolvedTaskListId = task_list_id ? resolveId(task_list_id, "task_lists") : undefined;
      const tasks = searchTasks({
        query,
        project_id: resolvedProjectId,
        task_list_id: resolvedTaskListId,
        ...filters,
      });
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
}

// 16. sync
if (shouldRegisterTool("sync")) {
server.tool(
  "sync",
  "Sync tasks between local DB and agent task list.",
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
}

// === AGENT TOOLS ===

// set_focus
if (shouldRegisterTool("set_focus")) {
server.tool(
  "set_focus",
  "Focus this agent on a project. All list/search/status tools will default to this project.",
  {
    agent_id: z.string().describe("Agent ID or name"),
    project_id: z.string().optional().describe("Project to focus on. Omit to clear."),
    task_list_id: z.string().optional().describe("Task list to focus on"),
  },
  async ({ agent_id, project_id, task_list_id }) => {
    try {
      const resolvedProject = project_id ? resolveId(project_id, "projects") : undefined;
      const focus: AgentFocus = { agent_id, project_id: resolvedProject, task_list_id };
      agentFocusMap.set(agent_id, focus);
      // Sync to DB
      try {
        const agent = getAgentByName(agent_id) || getAgent(agent_id);
        if (agent) {
          const db = getDatabase();
          db.run("UPDATE agents SET active_project_id = ? WHERE id = ?", [resolvedProject || null, agent.id]);
        }
      } catch {}
      const projectName = resolvedProject ? ` (${resolvedProject.slice(0, 8)})` : "";
      return { content: [{ type: "text" as const, text: `Focused on project${projectName}. Read tools will default to this scope. Pass explicit project_id to override.` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// get_focus
if (shouldRegisterTool("get_focus")) {
server.tool(
  "get_focus",
  "Get the current focus for an agent.",
  { agent_id: z.string().describe("Agent ID or name") },
  async ({ agent_id }) => {
    const focus = getAgentFocus(agent_id);
    if (!focus?.project_id) {
      return { content: [{ type: "text" as const, text: "No focus set. Showing all projects." }] };
    }
    return { content: [{ type: "text" as const, text: `Focused on project: ${focus.project_id}${focus.task_list_id ? `, task list: ${focus.task_list_id}` : ""}` }] };
  },
);
}

// unfocus
if (shouldRegisterTool("unfocus")) {
server.tool(
  "unfocus",
  "Clear focus — show all projects and tasks.",
  { agent_id: z.string().describe("Agent ID or name") },
  async ({ agent_id }) => {
    agentFocusMap.delete(agent_id);
    try {
      const agent = getAgentByName(agent_id) || getAgent(agent_id);
      if (agent) {
        const db = getDatabase();
        db.run("UPDATE agents SET active_project_id = NULL WHERE id = ?", [agent.id]);
      }
    } catch {}
    return { content: [{ type: "text" as const, text: "Focus cleared. Showing all projects." }] };
  },
);
}

// register_agent
if (shouldRegisterTool("register_agent")) {
server.tool(
  "register_agent",
  "Register an agent. Any name is allowed — the configured pool is advisory, not enforced. Returns a conflict error if the name is held by a recently-active agent.",
  {
    name: z.string().describe("Agent name — any name is allowed. Use suggest_agent_name to see pool suggestions and avoid conflicts."),
    description: z.string().optional(),
    capabilities: z.array(z.string()).optional().describe("Agent capabilities/skills for task routing (e.g. ['typescript', 'testing', 'devops'])"),
    session_id: z.string().optional().describe("Unique ID for this coding session (e.g. process PID + timestamp, or env var). Used to detect name collisions across sessions. Store it and pass on every register_agent call."),
    working_dir: z.string().optional().describe("Working directory of this session — used to look up the project's agent pool and identify who holds the name in a conflict"),
    force: z.boolean().optional().describe("Force takeover of an active agent's name. Use with caution — only when you know the previous session is dead."),
  },
  async ({ name, description, capabilities, session_id, working_dir, force }) => {
    try {
      // Look up the pool for this project (from config, based on working_dir) — null = no restriction
      const pool = getAgentPoolForProject(working_dir);
      const result = registerAgent({ name, description, capabilities, session_id, working_dir, force, pool: pool || undefined });
      if (isAgentConflict(result)) {
        const suggestLine = result.suggestions && result.suggestions.length > 0
          ? `\nAvailable names: ${result.suggestions.join(", ")}`
          : "";
        const hint = `CONFLICT: ${result.message}${suggestLine}`;
        return {
          content: [{ type: "text" as const, text: hint }],
          isError: true,
        };
      }
      const agent = result;
      const poolLine = pool ? `\nPool: [${pool.join(", ")}]` : "";
      return {
        content: [{
          type: "text" as const,
          text: `Agent registered:\nID: ${agent.id}\nName: ${agent.name}${agent.description ? `\nDescription: ${agent.description}` : ""}\nSession: ${agent.session_id ?? "unbound"}${poolLine}\nCreated: ${agent.created_at}\nLast seen: ${agent.last_seen_at}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// suggest_agent_name
if (shouldRegisterTool("suggest_agent_name")) {
server.tool(
  "suggest_agent_name",
  "Get available agent names for a project. Shows configured pool, active agents, and suggestions. If no pool is configured, any name is allowed.",
  {
    working_dir: z.string().optional().describe("Your working directory — used to look up the project's allowed name pool from config"),
  },
  async ({ working_dir }) => {
    try {
      const pool = getAgentPoolForProject(working_dir);
      const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const allActive = listAgents().filter(a => a.last_seen_at > cutoff);

      if (!pool) {
        // No pool configured — any name works, just show active agents to avoid conflicts
        const lines = [
          "No agent pool configured — any name is allowed.",
          allActive.length > 0
            ? `Active agents (avoid these names): ${allActive.map(a => `${a.name} (seen ${Math.round((Date.now() - new Date(a.last_seen_at).getTime()) / 60000)}m ago)`).join(", ")}`
            : "No active agents.",
          "\nTo restrict names, configure agent_pool or project_pools in ~/.hasna/todos/config.json",
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }

      const available = getAvailableNamesFromPool(pool, getDatabase());
      const activeInPool = allActive.filter(a => pool.map(n => n.toLowerCase()).includes(a.name));
      const lines = [
        `Project pool: ${pool.join(", ")}`,
        `Available now (${available.length}): ${available.length > 0 ? available.join(", ") : "none — all names in use"}`,
        activeInPool.length > 0 ? `Active agents: ${activeInPool.map(a => `${a.name} (seen ${Math.round((Date.now() - new Date(a.last_seen_at).getTime()) / 60000)}m ago)`).join(", ")}` : "Active agents: none",
        available.length > 0 ? `\nSuggested: ${available[0]}` : "\nNo names available. Wait for an active agent to go stale (30min timeout).",
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// list_agents
if (shouldRegisterTool("list_agents")) {
server.tool(
  "list_agents",
  "List all registered agents. By default shows only active agents — set include_archived to see archived ones too.",
  {
    include_archived: z.boolean().optional().describe("Include archived agents in the list (default: false)"),
  },
  async ({ include_archived }) => {
    try {
      const agents = listAgents({ include_archived: include_archived ?? false });
      if (agents.length === 0) {
        return { content: [{ type: "text" as const, text: "No agents registered." }] };
      }
      const text = agents.map((a) => {
        const statusTag = a.status === "archived" ? " [archived]" : "";
        return `${a.id} | ${a.name}${statusTag}${a.description ? ` - ${a.description}` : ""} (last seen: ${a.last_seen_at})`;
      }).join("\n");
      return { content: [{ type: "text" as const, text: `${agents.length} agent(s):\n${text}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// get_agent
if (shouldRegisterTool("get_agent")) {
server.tool(
  "get_agent",
  "Get agent details by ID or name. Provide one of id or name.",
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
}

// rename_agent
if (shouldRegisterTool("rename_agent")) {
server.tool(
  "rename_agent",
  "Rename an agent. Resolve by id or current name.",
  {
    id: z.string().optional(),
    name: z.string().optional(),
    new_name: z.string(),
  },
  async ({ id, name, new_name }) => {
    try {
      if (!id && !name) {
        return { content: [{ type: "text" as const, text: "Provide either id or name." }], isError: true };
      }
      const agent = id ? getAgent(id) : getAgentByName(name!);
      if (!agent) {
        return { content: [{ type: "text" as const, text: `Agent not found: ${id || name}` }], isError: true };
      }
      const updated = updateAgent(agent.id, { name: new_name });
      return {
        content: [{
          type: "text" as const,
          text: `Agent renamed: ${agent.name} -> ${updated.name}\nID: ${updated.id}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// update_agent
if (shouldRegisterTool("update_agent")) {
server.tool(
  "update_agent",
  "Update an agent's description, role, title, or other metadata. Resolve by id or name.",
  {
    id: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    role: z.string().optional(),
    title: z.string().optional(),
    level: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    permissions: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
  },
  async ({ id, name, ...updates }) => {
    try {
      if (!id && !name) {
        return { content: [{ type: "text" as const, text: "Provide either id or name." }], isError: true };
      }
      const agent = id ? getAgent(id) : getAgentByName(name!);
      if (!agent) {
        return { content: [{ type: "text" as const, text: `Agent not found: ${id || name}` }], isError: true };
      }
      const updated = updateAgent(agent.id, updates);
      return { content: [{ type: "text" as const, text: `Agent updated: ${updated.name} (${updated.id.slice(0, 8)})` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// delete_agent
if (shouldRegisterTool("delete_agent")) {
server.tool(
  "delete_agent",
  "Archive an agent (soft delete). The agent is hidden from list_agents but preserved for task history. Use unarchive_agent to restore. Resolve by id or name.",
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
      const archived = archiveAgent(agent.id);
      return {
        content: [{
          type: "text" as const,
          text: archived ? `Agent archived: ${agent.name} (${agent.id}). Use unarchive_agent to restore.` : `Failed to archive agent: ${agent.name}`,
        }],
        isError: !archived,
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// unarchive_agent
if (shouldRegisterTool("unarchive_agent")) {
server.tool(
  "unarchive_agent",
  "Restore an archived agent back to active status. Resolve by id or name.",
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
      if (agent.status === "active") {
        return { content: [{ type: "text" as const, text: `Agent ${agent.name} is already active.` }] };
      }
      const restored = unarchiveAgent(agent.id);
      return {
        content: [{
          type: "text" as const,
          text: restored ? `Agent restored: ${agent.name} (${agent.id}) is now active.` : `Failed to restore agent: ${agent.name}`,
        }],
        isError: !restored,
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// heartbeat
if (shouldRegisterTool("heartbeat")) {
server.tool(
  "heartbeat",
  "Update your last_seen_at timestamp to signal you're still active. Call periodically during long tasks to prevent being marked stale.",
  {
    agent_id: z.string().describe("Your agent ID or name."),
  },
  async ({ agent_id }) => {
    try {
      const agent = getAgent(agent_id) || getAgentByName(agent_id);
      if (!agent) {
        return { content: [{ type: "text" as const, text: `Agent not found: ${agent_id}` }], isError: true };
      }
      updateAgentActivity(agent.id);
      return {
        content: [{
          type: "text" as const,
          text: `Heartbeat: ${agent.name} (${agent.id}) — last_seen_at updated to ${new Date().toISOString()}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// release_agent
if (shouldRegisterTool("release_agent")) {
server.tool(
  "release_agent",
  "Explicitly release/logout an agent — clears session binding and makes the name immediately available. Call this when your session ends instead of waiting for the 30-minute stale timeout.",
  {
    agent_id: z.string().describe("Your agent ID or name."),
    session_id: z.string().optional().describe("Your session ID — if provided, release only succeeds if it matches (prevents other sessions from releasing your agent)."),
  },
  async ({ agent_id, session_id }) => {
    try {
      const agent = getAgent(agent_id) || getAgentByName(agent_id);
      if (!agent) {
        return { content: [{ type: "text" as const, text: `Agent not found: ${agent_id}` }], isError: true };
      }
      const released = releaseAgent(agent.id, session_id);
      if (!released) {
        return { content: [{ type: "text" as const, text: `Release denied: session_id does not match agent's current session.` }], isError: true };
      }
      return {
        content: [{
          type: "text" as const,
          text: `Agent released: ${agent.name} (${agent.id}) — session cleared, name is now available.`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// === TASK LIST TOOLS ===

// create_task_list
if (shouldRegisterTool("create_task_list")) {
server.tool(
  "create_task_list",
  "Create a task list container for organizing tasks.",
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
}

// list_task_lists
if (shouldRegisterTool("list_task_lists")) {
server.tool(
  "list_task_lists",
  "List all task lists, optionally filtered by project.",
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
}

// get_task_list
if (shouldRegisterTool("get_task_list")) {
server.tool(
  "get_task_list",
  "Get task list details including slug and metadata.",
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
}

// update_task_list
if (shouldRegisterTool("update_task_list")) {
server.tool(
  "update_task_list",
  "Update a task list's name or description.",
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
}

// delete_task_list
if (shouldRegisterTool("delete_task_list")) {
server.tool(
  "delete_task_list",
  "Delete a task list. Tasks are orphaned, not deleted.",
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
}

// === AUDIT LOG TOOLS ===

// get_task_history
if (shouldRegisterTool("get_task_history")) {
server.tool(
  "get_task_history",
  "Get audit log — field changes with timestamps and actors.",
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
}

// get_recent_activity
if (shouldRegisterTool("get_recent_activity")) {
server.tool(
  "get_recent_activity",
  "Get recent task changes — global activity feed.",
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
}

// recap
if (shouldRegisterTool("recap")) {
server.tool(
  "recap",
  "Get a summary of what happened in the last N hours — completed tasks with duration, new tasks, in-progress work, blockers, stale tasks, and agent activity. Great for session start or standup prep.",
  {
    hours: z.number().optional().describe("Look back N hours (default: 8)"),
    project_id: z.string().optional().describe("Filter to a specific project"),
  },
  async ({ hours, project_id }) => {
    try {
      const { getRecap } = await import("../db/audit.js");
      const recap = getRecap(hours || 8, project_id);
      const lines: string[] = [`Recap — last ${recap.hours}h (since ${recap.since})`];

      if (recap.completed.length > 0) {
        lines.push(`\nCompleted (${recap.completed.length}):`);
        for (const t of recap.completed) {
          const dur = t.duration_minutes != null ? ` (${t.duration_minutes}m)` : "";
          lines.push(`  ✓ ${t.short_id || t.id.slice(0, 8)} ${t.title}${dur}${t.assigned_to ? ` — ${t.assigned_to}` : ""}`);
        }
      }
      if (recap.in_progress.length > 0) {
        lines.push(`\nIn Progress (${recap.in_progress.length}):`);
        for (const t of recap.in_progress) lines.push(`  → ${t.short_id || t.id.slice(0, 8)} ${t.title}${t.assigned_to ? ` — ${t.assigned_to}` : ""}`);
      }
      if (recap.blocked.length > 0) {
        lines.push(`\nBlocked (${recap.blocked.length}):`);
        for (const t of recap.blocked) lines.push(`  ✗ ${t.short_id || t.id.slice(0, 8)} ${t.title}`);
      }
      if (recap.stale.length > 0) {
        lines.push(`\nStale (${recap.stale.length}):`);
        for (const t of recap.stale) lines.push(`  ! ${t.short_id || t.id.slice(0, 8)} ${t.title} — updated ${t.updated_at}`);
      }
      if (recap.agents.length > 0) {
        lines.push(`\nAgents:`);
        for (const a of recap.agents) lines.push(`  ${a.name}: ${a.completed_count} done, ${a.in_progress_count} active (seen ${a.last_seen_at})`);
      }
      lines.push(`\nCreated: ${recap.created.length} new tasks`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// standup
if (shouldRegisterTool("standup")) {
server.tool(
  "standup",
  "Generate standup notes — completed tasks since yesterday grouped by agent, in-progress work, and blockers. Copy-paste ready.",
  {
    hours: z.number().optional().describe("Look back N hours (default: 24)"),
    project_id: z.string().optional(),
  },
  async ({ hours, project_id }) => {
    try {
      const { getRecap } = await import("../db/audit.js");
      const recap = getRecap(hours || 24, project_id);
      const lines: string[] = [`Standup — last ${recap.hours}h`];

      // Group completed by agent
      const byAgent = new Map<string, any[]>();
      for (const t of recap.completed) {
        const agent = t.assigned_to || "unassigned";
        if (!byAgent.has(agent)) byAgent.set(agent, []);
        byAgent.get(agent)!.push(t);
      }

      if (byAgent.size > 0) {
        lines.push("\nDone:");
        for (const [agent, tasks] of byAgent) {
          lines.push(`  ${agent}:`);
          for (const t of tasks) {
            const dur = t.duration_minutes != null ? ` (${t.duration_minutes}m)` : "";
            lines.push(`    ✓ ${t.short_id || t.id.slice(0, 8)} ${t.title}${dur}`);
          }
        }
      } else {
        lines.push("\nNothing completed.");
      }

      if (recap.in_progress.length > 0) {
        lines.push("\nIn Progress:");
        for (const t of recap.in_progress) lines.push(`  → ${t.short_id || t.id.slice(0, 8)} ${t.title}${t.assigned_to ? ` — ${t.assigned_to}` : ""}`);
      }
      if (recap.blocked.length > 0) {
        lines.push("\nBlocked:");
        for (const t of recap.blocked) lines.push(`  ✗ ${t.short_id || t.id.slice(0, 8)} ${t.title}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// log_cost
if (shouldRegisterTool("log_cost")) {
server.tool(
  "log_cost",
  "Log token usage and cost to a task. Accumulates — call after each LLM invocation.",
  { task_id: z.string(), tokens: z.number().describe("Token count"), usd: z.number().describe("Cost in USD") },
  async ({ task_id, tokens, usd }) => {
    try {
      const { logCost } = await import("../db/tasks.js");
      const resolvedId = resolveId(task_id, "tasks");
      logCost(resolvedId, tokens, usd);
      return { content: [{ type: "text" as const, text: `Logged ${tokens} tokens ($${usd.toFixed(4)}) to ${task_id}` }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// log_trace
if (shouldRegisterTool("log_trace")) {
server.tool(
  "log_trace",
  "Log a trace entry (tool call, LLM call, error, handoff) to a task for observability.",
  {
    task_id: z.string(), agent_id: z.string().optional(),
    trace_type: z.enum(["tool_call", "llm_call", "error", "handoff", "custom"]),
    name: z.string().optional(), input_summary: z.string().optional(), output_summary: z.string().optional(),
    duration_ms: z.number().optional(), tokens: z.number().optional(), cost_usd: z.number().optional(),
  },
  async ({ task_id, agent_id, trace_type, name, input_summary, output_summary, duration_ms, tokens, cost_usd }) => {
    try {
      const { logTrace } = await import("../db/traces.js");
      const resolvedId = resolveId(task_id, "tasks");
      const trace = logTrace({ task_id: resolvedId, agent_id, trace_type, name, input_summary, output_summary, duration_ms, tokens, cost_usd });
      return { content: [{ type: "text" as const, text: `Trace logged: ${trace.id} [${trace_type}] ${name || ""}` }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// get_traces
if (shouldRegisterTool("get_traces")) {
server.tool(
  "get_traces",
  "Get execution traces for a task — tool calls, LLM invocations, errors, handoffs.",
  { task_id: z.string() },
  async ({ task_id }) => {
    try {
      const { getTaskTraces, getTraceStats } = await import("../db/traces.js");
      const resolvedId = resolveId(task_id, "tasks");
      const traces = getTaskTraces(resolvedId);
      const stats = getTraceStats(resolvedId);
      const lines = [`Traces for ${task_id}: ${stats.total} total (${stats.tool_calls} tools, ${stats.llm_calls} LLM, ${stats.errors} errors) | ${stats.total_tokens} tokens | $${stats.total_cost_usd.toFixed(4)} | ${stats.total_duration_ms}ms`];
      for (const t of traces.slice(0, 20)) {
        lines.push(`  ${t.created_at} [${t.trace_type}] ${t.name || ""} ${t.tokens ? t.tokens + "tok" : ""} ${t.duration_ms ? t.duration_ms + "ms" : ""}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// save_snapshot
if (shouldRegisterTool("save_snapshot")) {
server.tool(
  "save_snapshot",
  "Save a structured context snapshot — what you were working on, what files are open, what was tried, blockers, next steps. Call on session end or before handoff.",
  {
    agent_id: z.string().optional(), task_id: z.string().optional(), project_id: z.string().optional(),
    snapshot_type: z.enum(["interrupt", "complete", "handoff", "checkpoint"]),
    plan_summary: z.string().optional(), files_open: z.array(z.string()).optional(),
    attempts: z.array(z.string()).optional(), blockers: z.array(z.string()).optional(), next_steps: z.string().optional(),
  },
  async ({ agent_id, task_id, project_id, snapshot_type, plan_summary, files_open, attempts, blockers, next_steps }) => {
    try {
      const { saveSnapshot } = await import("../db/snapshots.js");
      const snap = saveSnapshot({ agent_id, task_id, project_id, snapshot_type, plan_summary, files_open, attempts, blockers, next_steps });
      return { content: [{ type: "text" as const, text: `Snapshot saved: ${snap.id} [${snapshot_type}]${plan_summary ? " — " + plan_summary.slice(0, 80) : ""}` }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// get_snapshot
if (shouldRegisterTool("get_snapshot")) {
server.tool(
  "get_snapshot",
  "Get the latest context snapshot for an agent or task — use to resume work after interruption.",
  { agent_id: z.string().optional(), task_id: z.string().optional() },
  async ({ agent_id, task_id }) => {
    try {
      const { getLatestSnapshot } = await import("../db/snapshots.js");
      const snap = getLatestSnapshot(agent_id, task_id);
      if (!snap) return { content: [{ type: "text" as const, text: "No snapshot found." }] };
      const lines = [`Snapshot [${snap.snapshot_type}] from ${snap.created_at}`];
      if (snap.plan_summary) lines.push(`Plan: ${snap.plan_summary}`);
      if (snap.files_open.length > 0) lines.push(`Files: ${snap.files_open.join(", ")}`);
      if (snap.blockers.length > 0) lines.push(`Blockers: ${snap.blockers.join(", ")}`);
      if (snap.next_steps) lines.push(`Next: ${snap.next_steps}`);
      if (snap.attempts.length > 0) lines.push(`Attempts: ${snap.attempts.join("; ")}`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// set_budget
if (shouldRegisterTool("set_budget")) {
server.tool(
  "set_budget",
  "Set execution budget for an agent — max concurrent tasks, cost limit, time limit per period.",
  {
    agent_id: z.string(), max_concurrent: z.number().optional(),
    max_cost_usd: z.number().optional(), max_task_minutes: z.number().optional(), period_hours: z.number().optional(),
  },
  async ({ agent_id, max_concurrent, max_cost_usd, max_task_minutes, period_hours }) => {
    try {
      const { setBudget } = await import("../db/budgets.js");
      const budget = setBudget(agent_id, { max_concurrent, max_cost_usd, max_task_minutes, period_hours });
      return { content: [{ type: "text" as const, text: `Budget set for ${agent_id}: max ${budget.max_concurrent} concurrent, $${budget.max_cost_usd ?? "∞"} cost limit, ${budget.period_hours}h period` }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// check_budget
if (shouldRegisterTool("check_budget")) {
server.tool(
  "check_budget",
  "Check if an agent is within their execution budget (concurrent tasks, cost, time).",
  { agent_id: z.string() },
  async ({ agent_id }) => {
    try {
      const { checkBudget } = await import("../db/budgets.js");
      const result = checkBudget(agent_id);
      if (result.allowed) {
        return { content: [{ type: "text" as const, text: `Budget OK: ${result.current_concurrent}/${result.max_concurrent} concurrent tasks` }] };
      }
      return { content: [{ type: "text" as const, text: `BUDGET EXCEEDED: ${result.reason}` }], isError: true };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// import_github_issue
if (shouldRegisterTool("import_github_issue")) {
server.tool(
  "import_github_issue",
  "Import a GitHub issue as a task. Requires gh CLI installed and authenticated.",
  {
    url: z.string().describe("GitHub issue URL (e.g. https://github.com/owner/repo/issues/42)"),
    project_id: z.string().optional(),
    task_list_id: z.string().optional(),
  },
  async ({ url, project_id, task_list_id }) => {
    try {
      const { parseGitHubUrl, fetchGitHubIssue, issueToTask } = await import("../lib/github.js");
      const parsed = parseGitHubUrl(url);
      if (!parsed) return { content: [{ type: "text" as const, text: "Invalid GitHub issue URL." }], isError: true };
      const issue = fetchGitHubIssue(parsed.owner, parsed.repo, parsed.number);
      const input = issueToTask(issue, { project_id, task_list_id });
      const task = createTask(input);
      return { content: [{ type: "text" as const, text: `Imported GH#${issue.number}: ${issue.title}\nTask: ${task.short_id || task.id} [${task.priority}]\nLabels: ${issue.labels.join(", ") || "none"}` }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// blame
if (shouldRegisterTool("blame")) {
server.tool(
  "blame",
  "Show which tasks and agents touched a file — combines task_files and task_commits data.",
  {
    path: z.string().describe("File path to look up"),
  },
  async ({ path }) => {
    try {
      const { findTasksByFile } = await import("../db/task-files.js");
      const db = getDatabase();
      const taskFiles = findTasksByFile(path, db);

      const commitRows = db.query(
        "SELECT tc.*, t.title, t.short_id FROM task_commits tc JOIN tasks t ON t.id = tc.task_id WHERE tc.files_changed LIKE ? ORDER BY tc.committed_at DESC"
      ).all(`%${path}%`) as any[];

      const lines: string[] = [`Blame: ${path}`];

      if (taskFiles.length > 0) {
        lines.push(`\nTask File Links (${taskFiles.length}):`);
        for (const tf of taskFiles) {
          const task = getTask(tf.task_id, db);
          lines.push(`  ${task?.short_id || tf.task_id.slice(0, 8)} ${task?.title || "?"} — ${(tf as any).role || "file"}`);
        }
      }

      if (commitRows.length > 0) {
        lines.push(`\nCommit Links (${commitRows.length}):`);
        for (const c of commitRows) lines.push(`  ${c.sha?.slice(0, 7)} ${c.short_id || c.task_id.slice(0, 8)} ${c.title || ""} — ${c.author || ""}`);
      }

      if (taskFiles.length === 0 && commitRows.length === 0) {
        lines.push("No task or commit links found.");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// burndown
if (shouldRegisterTool("burndown")) {
server.tool(
  "burndown",
  "ASCII burndown chart showing actual vs ideal progress for a plan, project, or task list.",
  {
    plan_id: z.string().optional(),
    project_id: z.string().optional(),
    task_list_id: z.string().optional(),
  },
  async ({ plan_id, project_id, task_list_id }) => {
    try {
      const { getBurndown } = await import("../lib/burndown.js");
      const data = getBurndown({ plan_id, project_id, task_list_id });
      return { content: [{ type: "text" as const, text: `Burndown: ${data.completed}/${data.total} done, ${data.remaining} remaining\n\n${data.chart}` }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// === WEBHOOK TOOLS ===

// create_webhook
if (shouldRegisterTool("create_webhook")) {
server.tool(
  "create_webhook",
  "Register a webhook for task change events.",
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
}

// list_webhooks
if (shouldRegisterTool("list_webhooks")) {
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
}

// delete_webhook
if (shouldRegisterTool("delete_webhook")) {
server.tool(
  "delete_webhook",
  "Delete a webhook by ID.",
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
}

// === TEMPLATE TOOLS ===

// create_template
if (shouldRegisterTool("create_template")) {
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
}

// list_templates
if (shouldRegisterTool("list_templates")) {
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
}

// create_task_from_template
if (shouldRegisterTool("create_task_from_template")) {
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
}

// delete_template
if (shouldRegisterTool("delete_template")) {
server.tool(
  "delete_template",
  "Delete a task template by ID.",
  { id: z.string() },
  async ({ id }) => {
    try {
      const { deleteTemplate } = await import("../db/templates.js");
      const deleted = deleteTemplate(id);
      return { content: [{ type: "text" as const, text: deleted ? "Template deleted." : "Template not found." }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// === APPROVAL TOOLS ===

// approve_task
if (shouldRegisterTool("approve_task")) {
server.tool(
  "approve_task",
  "Approve a task with requires_approval=true.",
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
}

// fail_task
if (shouldRegisterTool("fail_task")) {
server.tool(
  "fail_task",
  "Mark a task as failed with structured reason and optional auto-retry.",
  {
    id: z.string(),
    agent_id: z.string().optional(),
    reason: z.string().optional(),
    error_code: z.string().optional(),
    retry: z.boolean().optional(),
    retry_after: z.string().optional(),
  },
  async ({ id, agent_id, reason, error_code, retry, retry_after }) => {
    try {
      const resolvedId = resolveId(id);
      const result = failTask(resolvedId, agent_id, reason, { retry, retry_after, error_code });
      let text = `failed: ${formatTask(result.task)}`;
      if (reason) text += `\nReason: ${reason}`;
      if (result.retryTask) {
        text += `\nRetry task created: ${formatTask(result.retryTask)}`;
      }
      return { content: [{ type: "text" as const, text }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// get_my_tasks — agent discovery
if (shouldRegisterTool("get_my_tasks")) {
server.tool(
  "get_my_tasks",
  "Get tasks assigned to/created by an agent with stats.",
  {
    agent_name: z.string(),
  },
  async ({ agent_name }) => {
    try {
      const agentResult = registerAgent({ name: agent_name });
      if (isAgentConflict(agentResult)) {
        return { content: [{ type: "text" as const, text: `CONFLICT: ${agentResult.message}` }], isError: true };
      }
      const agent = agentResult;
      // Use DB-level filtering for efficiency — query by both name and agent ID
      const byName = listTasks({ assigned_to: agent_name });
      const byId = listTasks({ agent_id: agent.id });
      // Deduplicate
      const seen = new Set<string>();
      const myTasks = [...byName, ...byId].filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
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
}

// get_org_chart — org hierarchy
if (shouldRegisterTool("get_org_chart")) {
server.tool(
  "get_org_chart",
  "Get agent org chart showing reporting hierarchy with roles, titles, capabilities, and activity status.",
  {
    format: z.enum(["text", "json"]).optional().describe("Output format (default: text)"),
    role: z.string().optional().describe("Filter by agent role (e.g. 'lead', 'developer')"),
    active_only: z.coerce.boolean().optional().describe("Only show agents active in last 30 min"),
  },
  async ({ format, role, active_only }) => {
    try {
      const { getOrgChart } = await import("../db/agents.js");
      let tree: any[] = getOrgChart();

      // Filter helpers
      const now = Date.now();
      const ACTIVE_MS = 30 * 60 * 1000;

      function filterTree(nodes: any[]): any[] {
        return nodes
          .map(n => ({ ...n, reports: filterTree(n.reports) }))
          .filter(n => {
            if (role && n.agent.role !== role) return false;
            if (active_only) {
              const lastSeen = new Date(n.agent.last_seen_at).getTime();
              if (now - lastSeen > ACTIVE_MS) return false;
            }
            return true;
          });
      }
      if (role || active_only) tree = filterTree(tree);

      if (format === "json") {
        return { content: [{ type: "text" as const, text: JSON.stringify(tree, null, 2) }] };
      }

      function render(nodes: any[], indent = 0): string {
        return nodes.map(n => {
          const prefix = "  ".repeat(indent);
          const title = n.agent.title ? ` — ${n.agent.title}` : "";
          const level = n.agent.level ? ` [${n.agent.level}]` : "";
          const caps = n.agent.capabilities?.length > 0 ? ` {${n.agent.capabilities.join(", ")}}` : "";
          const lastSeen = new Date(n.agent.last_seen_at).getTime();
          const active = now - lastSeen < ACTIVE_MS ? " ●" : " ○";
          const line = `${prefix}${active} ${n.agent.name}${title}${level}${caps}`;
          const children = n.reports.length > 0 ? "\n" + render(n.reports, indent + 1) : "";
          return line + children;
        }).join("\n");
      }
      const text = tree.length > 0 ? render(tree) : "No agents registered.";
      return { content: [{ type: "text" as const, text }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// set_reports_to — set agent hierarchy
if (shouldRegisterTool("set_reports_to")) {
server.tool(
  "set_reports_to",
  "Set agent reporting relationship in org chart.",
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
}

// bulk_update_tasks
if (shouldRegisterTool("bulk_update_tasks")) {
server.tool(
  "bulk_update_tasks",
  "Update multiple tasks at once. Two modes: (1) task_ids + shared fields — apply the same changes to all; (2) updates array — per-task fields, each entry has id plus any fields to update.",
  {
    // Mode 1: same fields applied to all
    task_ids: z.array(z.string()).optional().describe("Task IDs to update with the same fields (mode 1)"),
    status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    assigned_to: z.string().optional(),
    tags: z.array(z.string()).optional(),
    // Mode 2: per-task updates
    updates: z.array(z.object({
      id: z.string(),
      status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      assigned_to: z.string().optional(),
      tags: z.array(z.string()).optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      plan_id: z.string().optional(),
      task_list_id: z.string().optional(),
    })).optional().describe("Per-task updates — each entry has id plus fields to update (mode 2)"),
  },
  async ({ task_ids, updates, ...sharedFields }) => {
    try {
      let result: { updated: number; failed: { id: string; error: string }[] };

      if (updates && updates.length > 0) {
        // Mode 2: per-task updates
        const d = getDatabase();
        let updated = 0;
        const failed: { id: string; error: string }[] = [];
        const tx = d.transaction(() => {
          for (const entry of updates) {
            try {
              const { id, ...fields } = entry;
              const resolvedId = resolveId(id);
              const task = getTask(resolvedId);
              if (!task) { failed.push({ id, error: "Task not found" }); continue; }
              if (fields.plan_id) fields.plan_id = resolveId(fields.plan_id, "plans");
              if (fields.task_list_id) fields.task_list_id = resolveId(fields.task_list_id, "task_lists");
              updateTask(resolvedId, { ...fields, version: task.version }, d);
              updated++;
            } catch (e) {
              failed.push({ id: entry.id, error: e instanceof Error ? e.message : String(e) });
            }
          }
        });
        tx();
        result = { updated, failed };
      } else if (task_ids && task_ids.length > 0) {
        // Mode 1: same fields applied to all
        const resolvedIds = task_ids.map(id => resolveId(id));
        result = bulkUpdateTasks(resolvedIds, sharedFields);
      } else {
        return { content: [{ type: "text" as const, text: "Provide either task_ids (mode 1) or updates array (mode 2)." }], isError: true };
      }

      const parts = [`Updated ${result.updated} task(s).`];
      if (result.failed.length > 0) {
        parts.push(`Failed ${result.failed.length}:`);
        for (const f of result.failed) parts.push(`  ${f.id.slice(0, 8)}: ${f.error}`);
      }
      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// clone_task
if (shouldRegisterTool("clone_task")) {
server.tool(
  "clone_task",
  "Duplicate a task with optional field overrides.",
  {
    task_id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
    project_id: z.string().optional(),
    plan_id: z.string().optional(),
    task_list_id: z.string().optional(),
    assigned_to: z.string().optional(),
    tags: z.array(z.string()).optional(),
    estimated_minutes: z.number().optional(),
  },
  async ({ task_id, ...overrides }) => {
    try {
      const resolvedId = resolveId(task_id);
      const resolved = { ...overrides };
      if (resolved.project_id) resolved.project_id = resolveId(resolved.project_id, "projects");
      if (resolved.plan_id) resolved.plan_id = resolveId(resolved.plan_id, "plans");
      if (resolved.task_list_id) resolved.task_list_id = resolveId(resolved.task_list_id, "task_lists");
      const task = cloneTask(resolvedId, resolved);
      return { content: [{ type: "text" as const, text: `cloned: ${formatTask(task)}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// get_task_stats
if (shouldRegisterTool("get_task_stats")) {
server.tool(
  "get_task_stats",
  "Get task analytics: counts by status, priority, agent.",
  {
    project_id: z.string().optional(),
    task_list_id: z.string().optional(),
    agent_id: z.string().optional(),
  },
  async ({ project_id, task_list_id, agent_id }) => {
    try {
      const filters: { project_id?: string; task_list_id?: string; agent_id?: string } = {};
      if (project_id) filters.project_id = resolveId(project_id, "projects");
      if (task_list_id) filters.task_list_id = resolveId(task_list_id, "task_lists");
      if (agent_id) filters.agent_id = agent_id;
      const stats = getTaskStats(Object.keys(filters).length > 0 ? filters : undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// get_task_graph
if (shouldRegisterTool("get_task_graph")) {
server.tool(
  "get_task_graph",
  "Get full dependency tree for a task.",
  {
    id: z.string(),
    direction: z.enum(["up", "down", "both"]).optional(),
  },
  async ({ id, direction }) => {
    try {
      const taskId = resolveId(id, "tasks");
      const graph = getTaskGraph(taskId, direction || "both");

      function formatNode(node: { task: { status: string; short_id: string | null; id: string; title: string; is_blocked: boolean }; depends_on: any[]; blocks: any[] }, indent: number): string {
        const prefix = "  ".repeat(indent);
        const idLabel = node.task.short_id || node.task.id.slice(0, 8);
        const blocked = node.task.is_blocked ? " (blocked: yes)" : "";
        let out = `${prefix}[${node.task.status}] ${idLabel} | ${node.task.title}${blocked}\n`;
        if (node.depends_on.length > 0) {
          out += `${prefix}  Depends on:\n`;
          for (const dep of node.depends_on) {
            out += formatNode(dep, indent + 2);
          }
        }
        if (node.blocks.length > 0) {
          out += `${prefix}  Blocks:\n`;
          for (const dep of node.blocks) {
            out += formatNode(dep, indent + 2);
          }
        }
        return out;
      }

      let text = `Task: ${formatNode(graph, 0)}`;
      if (graph.depends_on.length > 0) {
        text += `\nDepends on:\n`;
        for (const dep of graph.depends_on) {
          text += formatNode(dep, 1);
        }
      }
      if (graph.blocks.length > 0) {
        text += `\nBlocks:\n`;
        for (const dep of graph.blocks) {
          text += formatNode(dep, 1);
        }
      }

      return { content: [{ type: "text" as const, text }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// bulk_create_tasks
if (shouldRegisterTool("bulk_create_tasks")) {
server.tool(
  "bulk_create_tasks",
  "Create multiple tasks atomically with dependency support.",
  {
    tasks: z.array(z.object({
      temp_id: z.string().optional(),
      title: z.string(),
      description: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
      project_id: z.string().optional(),
      plan_id: z.string().optional(),
      task_list_id: z.string().optional(),
      agent_id: z.string().optional(),
      assigned_to: z.string().optional(),
      tags: z.array(z.string()).optional(),
      estimated_minutes: z.number().optional(),
      depends_on_temp_ids: z.array(z.string()).optional(),
    })),
    project_id: z.string().optional(),
    plan_id: z.string().optional(),
    task_list_id: z.string().optional(),
  },
  async ({ tasks, project_id, plan_id, task_list_id }) => {
    try {
      const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
      const resolvedPlanId = plan_id ? resolveId(plan_id, "plans") : undefined;
      const resolvedTaskListId = task_list_id ? resolveId(task_list_id, "task_lists") : undefined;

      const enrichedTasks = tasks.map(t => ({
        ...t,
        project_id: t.project_id || resolvedProjectId,
        plan_id: t.plan_id || resolvedPlanId,
        task_list_id: t.task_list_id || resolvedTaskListId,
      }));

      const result = bulkCreateTasks(enrichedTasks);
      const lines = result.created.map(t => {
        const tid = t.temp_id ? `[${t.temp_id}] ` : "";
        const sid = t.short_id || t.id.slice(0, 8);
        return `  ${tid}${sid} | ${t.title}`;
      });
      return { content: [{ type: "text" as const, text: `Created ${result.created.length} task(s):\n${lines.join("\n")}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// move_task
if (shouldRegisterTool("move_task")) {
server.tool(
  "move_task",
  "Move a task to a different list, project, or plan.",
  {
    task_id: z.string(),
    task_list_id: z.string().nullable().optional(),
    project_id: z.string().nullable().optional(),
    plan_id: z.string().nullable().optional(),
  },
  async ({ task_id, ...target }) => {
    try {
      const resolvedId = resolveId(task_id);
      const resolvedTarget: { task_list_id?: string | null; project_id?: string | null; plan_id?: string | null } = {};
      if (target.task_list_id !== undefined) resolvedTarget.task_list_id = target.task_list_id ? resolveId(target.task_list_id, "task_lists") : null;
      if (target.project_id !== undefined) resolvedTarget.project_id = target.project_id ? resolveId(target.project_id, "projects") : null;
      if (target.plan_id !== undefined) resolvedTarget.plan_id = target.plan_id ? resolveId(target.plan_id, "plans") : null;
      const task = moveTask(resolvedId, resolvedTarget);
      return { content: [{ type: "text" as const, text: `moved: ${formatTask(task)}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// get_next_task
if (shouldRegisterTool("get_next_task")) {
server.tool(
  "get_next_task",
  "Get the best pending task to work on next.",
  {
    agent_id: z.string().optional(),
    project_id: z.string().optional(),
    task_list_id: z.string().optional(),
    plan_id: z.string().optional(),
    tags: z.array(z.string()).optional(),
  },
  async ({ agent_id, project_id, task_list_id, plan_id, tags }) => {
    try {
      const filters: { project_id?: string; task_list_id?: string; plan_id?: string; tags?: string[] } = {};
      if (project_id) filters.project_id = resolveId(project_id, "projects");
      if (task_list_id) filters.task_list_id = resolveId(task_list_id, "task_lists");
      if (plan_id) filters.plan_id = resolveId(plan_id, "plans");
      if (tags) filters.tags = tags;

      const task = getNextTask(agent_id, Object.keys(filters).length > 0 ? filters : undefined);
      if (!task) {
        return { content: [{ type: "text" as const, text: "No tasks available — all pending tasks are blocked, locked, or none exist." }] };
      }
      return { content: [{ type: "text" as const, text: `next: ${formatTask(task)}\n${formatTaskDetail(task, 300)}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// get_active_work
if (shouldRegisterTool("get_active_work")) {
server.tool(
  "get_active_work",
  "See all in-progress tasks and who is working on them.",
  {
    project_id: z.string().optional(),
    task_list_id: z.string().optional(),
  },
  async ({ project_id, task_list_id }) => {
    try {
      const filters: { project_id?: string; task_list_id?: string } = {};
      if (project_id) filters.project_id = resolveId(project_id, "projects");
      if (task_list_id) filters.task_list_id = resolveId(task_list_id, "task_lists");

      const work = getActiveWork(Object.keys(filters).length > 0 ? filters : undefined);
      if (work.length === 0) {
        return { content: [{ type: "text" as const, text: "No active work — no tasks are currently in progress." }] };
      }
      const text = work.map(w => {
        const id = w.short_id || w.id.slice(0, 8);
        const agent = w.assigned_to || w.locked_by || "unassigned";
        const since = w.updated_at;
        return `${agent.padEnd(12)} | ${w.priority.padEnd(8)} | ${id} | ${w.title} (since ${since})`;
      }).join("\n");
      return { content: [{ type: "text" as const, text: `${work.length} active task(s):\n${text}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// get_tasks_changed_since
if (shouldRegisterTool("get_tasks_changed_since")) {
server.tool(
  "get_tasks_changed_since",
  "Get tasks modified after a timestamp for incremental sync.",
  {
    since: z.string(),
    project_id: z.string().optional(),
    task_list_id: z.string().optional(),
  },
  async ({ since, project_id, task_list_id }) => {
    try {
      const filters: { project_id?: string; task_list_id?: string } = {};
      if (project_id) filters.project_id = resolveId(project_id, "projects");
      if (task_list_id) filters.task_list_id = resolveId(task_list_id, "task_lists");

      const tasks = getTasksChangedSince(since, Object.keys(filters).length > 0 ? filters : undefined);
      if (tasks.length === 0) {
        return { content: [{ type: "text" as const, text: `No tasks changed since ${since}.` }] };
      }
      const text = tasks.map(t => {
        const assigned = t.assigned_to ? ` -> ${t.assigned_to}` : "";
        return `[${t.status}] ${t.id.slice(0, 8)} | ${t.priority} | ${t.title}${assigned} (updated: ${t.updated_at})`;
      }).join("\n");
      return { content: [{ type: "text" as const, text: `${tasks.length} task(s) changed since ${since}:\n${text}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// claim_next_task
if (shouldRegisterTool("claim_next_task")) {
server.tool(
  "claim_next_task",
  "Atomically claim, lock, and start the best pending task.",
  {
    agent_id: z.string(),
    project_id: z.string().optional(),
    task_list_id: z.string().optional(),
    plan_id: z.string().optional(),
    tags: z.array(z.string()).optional(),
  },
  async ({ agent_id, project_id, task_list_id, plan_id, tags }) => {
    try {
      const filters: { project_id?: string; task_list_id?: string; plan_id?: string; tags?: string[] } = {};
      if (project_id) filters.project_id = resolveId(project_id, "projects");
      if (task_list_id) filters.task_list_id = resolveId(task_list_id, "task_lists");
      if (plan_id) filters.plan_id = resolveId(plan_id, "plans");
      if (tags) filters.tags = tags;

      const task = claimNextTask(agent_id, Object.keys(filters).length > 0 ? filters : undefined);
      if (!task) {
        return { content: [{ type: "text" as const, text: "No tasks available to claim." }] };
      }
      return { content: [{ type: "text" as const, text: `claimed: ${formatTask(task)}\n${formatTaskDetail(task, 300)}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// steal_task
if (shouldRegisterTool("steal_task")) {
server.tool(
  "steal_task",
  "Work-stealing: take the highest-priority stale in_progress task from another agent and reassign it to you.",
  {
    agent_id: z.string().describe("Your agent ID"),
    stale_minutes: z.number().optional().describe("How long a task must be stale before stealing (default: 30)"),
    project_id: z.string().optional(),
    task_list_id: z.string().optional(),
  },
  async ({ agent_id, stale_minutes, project_id, task_list_id }) => {
    try {
      const task = stealTask(agent_id, { stale_minutes, project_id, task_list_id });
      if (!task) return { content: [{ type: "text" as const, text: "No stale tasks available to steal." }] };
      return { content: [{ type: "text" as const, text: `Stolen: ${formatTask(task)}\nPrevious owner: ${task.metadata?._stolen_from || "unknown"}` }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// claim_or_steal
if (shouldRegisterTool("claim_or_steal")) {
server.tool(
  "claim_or_steal",
  "Try to claim a pending task first; if none available, steal from a stale agent. Best single call for getting work.",
  {
    agent_id: z.string(),
    project_id: z.string().optional(),
    task_list_id: z.string().optional(),
    plan_id: z.string().optional(),
    tags: z.array(z.string()).optional(),
    stale_minutes: z.number().optional().describe("Stale threshold for work-stealing fallback (default: 30)"),
  },
  async ({ agent_id, project_id, task_list_id, plan_id, tags, stale_minutes }) => {
    try {
      const filters: any = {};
      if (project_id) filters.project_id = resolveId(project_id, "projects");
      if (task_list_id) filters.task_list_id = resolveId(task_list_id, "task_lists");
      if (plan_id) filters.plan_id = resolveId(plan_id, "plans");
      if (tags) filters.tags = tags;
      if (stale_minutes) filters.stale_minutes = stale_minutes;

      const result = claimOrSteal(agent_id, Object.keys(filters).length > 0 ? filters : undefined);
      if (!result) return { content: [{ type: "text" as const, text: "No tasks available to claim or steal." }] };
      const prefix = result.stolen ? "Stolen" : "Claimed";
      return { content: [{ type: "text" as const, text: `${prefix}: ${formatTask(result.task)}\n${formatTaskDetail(result.task, 300)}` }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// get_stale_tasks
if (shouldRegisterTool("get_stale_tasks")) {
server.tool(
  "get_stale_tasks",
  "Find stale in_progress tasks with no recent activity.",
  {
    stale_minutes: z.number().optional(),
    project_id: z.string().optional(),
    task_list_id: z.string().optional(),
  },
  async ({ stale_minutes, project_id, task_list_id }) => {
    try {
      const filters: { project_id?: string; task_list_id?: string } = {};
      if (project_id) filters.project_id = resolveId(project_id, "projects");
      if (task_list_id) filters.task_list_id = resolveId(task_list_id, "task_lists");

      const tasks = getStaleTasks(stale_minutes || 30, Object.keys(filters).length > 0 ? filters : undefined);
      if (tasks.length === 0) {
        return { content: [{ type: "text" as const, text: "No stale tasks found." }] };
      }
      const text = tasks.map(t => {
        const id = t.short_id || t.id.slice(0, 8);
        const agent = t.locked_by || t.assigned_to || "unknown";
        const staleFor = Math.round((Date.now() - new Date(t.updated_at).getTime()) / 60000);
        return `${id} | ${agent} | ${t.title} (stale ${staleFor}min)`;
      }).join("\n");
      return { content: [{ type: "text" as const, text: `${tasks.length} stale task(s):\n${text}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// get_status
if (shouldRegisterTool("get_status")) {
server.tool(
  "get_status",
  "Get a full project health snapshot — counts, active work, next task, stale/overdue summary.",
  {
    agent_id: z.string().optional(),
    project_id: z.string().optional(),
    task_list_id: z.string().optional(),
    explain_blocked: z.boolean().optional().describe("When true, include details about which pending tasks are blocked and by what"),
  },
  async ({ agent_id, project_id, task_list_id, explain_blocked }) => {
    try {
      const filters: { project_id?: string; task_list_id?: string } = {};
      if (project_id) filters.project_id = resolveId(project_id, "projects");
      if (task_list_id) filters.task_list_id = resolveId(task_list_id, "task_lists");

      const status = getStatus(Object.keys(filters).length > 0 ? filters : undefined, agent_id, { explain_blocked });

      const lines = [
        `Tasks: ${status.pending} pending | ${status.in_progress} active | ${status.completed} done | ${status.total} total`,
      ];

      if (status.stale_count > 0) lines.push(`⚠️  ${status.stale_count} stale (stuck in_progress)`);
      if (status.overdue_recurring > 0) lines.push(`🔁 ${status.overdue_recurring} overdue recurring`);

      if (status.active_work.length > 0) {
        lines.push(`\nActive (${status.active_work.length}):`);
        for (const w of status.active_work.slice(0, 5)) {
          const id = w.short_id || w.id.slice(0, 8);
          lines.push(`  ${id} | ${w.assigned_to || w.locked_by || '?'} | ${w.title}`);
        }
      }

      if (status.next_task) {
        lines.push(`\nNext up:`);
        lines.push(`  ${formatTask(status.next_task)}`);
      } else {
        lines.push(`\nNo pending tasks available.`);
      }

      if (status.blocked_tasks && status.blocked_tasks.length > 0) {
        lines.push(`\n⚡ ${status.blocked_tasks.length} task(s) blocked:`);
        for (const bt of status.blocked_tasks) {
          const id = bt.short_id || bt.id.slice(0, 8);
          lines.push(`  ${id} | ${bt.title}`);
          for (const dep of bt.blocked_by) {
            const depId = dep.short_id || dep.id.slice(0, 8);
            lines.push(`    <- blocked by ${depId} [${dep.status}] ${dep.title}`);
          }
        }
      }

      lines.push(`\nas_of: ${new Date().toISOString()} (pass to get_tasks_changed_since for incremental polling)`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// decompose_task
if (shouldRegisterTool("decompose_task")) {
server.tool(
  "decompose_task",
  "Break a task into subtasks in one call. Optionally chain them sequentially with depends_on_prev.",
  {
    parent_id: z.string(),
    subtasks: z.array(z.object({
      title: z.string(),
      description: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      assigned_to: z.string().optional(),
      estimated_minutes: z.number().optional(),
      tags: z.array(z.string()).optional(),
    })),
    depends_on_prev: z.boolean().optional(),
  },
  async ({ parent_id, subtasks, depends_on_prev }) => {
    try {
      const resolvedId = resolveId(parent_id);
      const result = decomposeTasks(resolvedId, subtasks, { depends_on_prev }, undefined);
      const lines = [
        `Decomposed: ${formatTask(result.parent)}`,
        `Created ${result.subtasks.length} subtask(s)${depends_on_prev ? " (chained)" : ""}:`,
        ...result.subtasks.map((t, i) => `  ${i + 1}. ${formatTask(t)}`),
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// set_task_status
if (shouldRegisterTool("set_task_status")) {
server.tool(
  "set_task_status",
  "Set task status without needing version. Auto-retries on conflict.",
  {
    id: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]),
    agent_id: z.string().optional(),
  },
  async ({ id, status, agent_id }) => {
    try {
      const resolvedId = resolveId(id);
      const task = setTaskStatus(resolvedId, status, agent_id);
      return { content: [{ type: "text" as const, text: `set: ${formatTask(task)}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// set_task_priority
if (shouldRegisterTool("set_task_priority")) {
server.tool(
  "set_task_priority",
  "Set task priority without needing version. Auto-retries on conflict.",
  {
    id: z.string(),
    priority: z.enum(["low", "medium", "high", "critical"]),
  },
  async ({ id, priority }) => {
    try {
      const resolvedId = resolveId(id);
      const task = setTaskPriority(resolvedId, priority);
      return { content: [{ type: "text" as const, text: `set: ${formatTask(task)}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// get_health — MCP health check (no REST server needed)
if (shouldRegisterTool("get_health")) {
server.tool(
  "get_health",
  "Check todos DB health. Returns status and issue summary.",
  {
    project_id: z.string().optional(),
  },
  async ({ project_id }) => {
    try {
      const checks: { name: string; status: "ok" | "warn" | "error"; value: string }[] = [];
      // Task count
      const all = listTasks({});
      checks.push({ name: "tasks", status: "ok", value: `${all.length} total` });
      // Stale
      const stale = getStaleTasks(30, project_id ? { project_id: resolveId(project_id, "projects") } : undefined);
      checks.push({ name: "stale", status: stale.length > 0 ? "warn" : "ok", value: `${stale.length} stuck in_progress >30min` });
      // Overdue recurring
      const nowStr = new Date().toISOString();
      const overdue = all.filter(t => (t as any).recurrence_rule && t.status === "pending" && t.due_at && t.due_at < nowStr);
      checks.push({ name: "overdue_recurring", status: overdue.length > 0 ? "warn" : "ok", value: `${overdue.length} overdue` });
      const status = checks.some(c => c.status === "error") ? "error" : checks.some(c => c.status === "warn") ? "warn" : "ok";
      const text = `Status: ${status}\n${checks.map(c => `  ${c.status === "ok" ? "✓" : "⚠"} ${c.name}: ${c.value}`).join("\n")}`;
      return { content: [{ type: "text" as const, text }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// task_context — deep orientation for a specific task
if (shouldRegisterTool("task_context")) {
server.tool(
  "task_context",
  "Full orientation for a specific task — details, description, dependencies (with blocked status), files, commits, comments, checklist. Use when starting work on a task.",
  {
    id: z.string().describe("Task ID, short_id, or partial ID"),
  },
  async ({ id }) => {
    try {
      const resolvedId = resolveId(id, "tasks");
      const task = getTaskWithRelations(resolvedId);
      if (!task) return { content: [{ type: "text" as const, text: `Task not found: ${id}` }], isError: true };

      const lines: string[] = [];
      const sid = task.short_id || task.id.slice(0, 8);
      lines.push(`${sid} [${task.status}] [${task.priority}] ${task.title}`);
      if (task.description) lines.push(`\nDescription:\n${task.description}`);
      if (task.assigned_to) lines.push(`Assigned: ${task.assigned_to}`);
      if (task.started_at) lines.push(`Started: ${task.started_at}`);
      if (task.completed_at) {
        lines.push(`Completed: ${task.completed_at}`);
        if (task.started_at) {
          const dur = Math.round((new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()) / 60000);
          lines.push(`Duration: ${dur}m`);
        }
      }
      if (task.tags.length > 0) lines.push(`Tags: ${task.tags.join(", ")}`);

      if (task.dependencies.length > 0) {
        lines.push(`\nDepends on (${task.dependencies.length}):`);
        for (const dep of task.dependencies) {
          const blocked = dep.status !== "completed" && dep.status !== "cancelled";
          lines.push(`  ${blocked ? "✗" : "✓"} ${dep.short_id || dep.id.slice(0, 8)} [${dep.status}] ${dep.title}`);
        }
        const unfinished = task.dependencies.filter(d => d.status !== "completed" && d.status !== "cancelled");
        if (unfinished.length > 0) lines.push(`⚠ BLOCKED by ${unfinished.length} unfinished dep(s)`);
      }

      if (task.blocked_by.length > 0) {
        lines.push(`\nBlocks (${task.blocked_by.length}):`);
        for (const b of task.blocked_by) lines.push(`  ${b.short_id || b.id.slice(0, 8)} [${b.status}] ${b.title}`);
      }

      if (task.subtasks.length > 0) {
        lines.push(`\nSubtasks (${task.subtasks.length}):`);
        for (const st of task.subtasks) lines.push(`  ${st.short_id || st.id.slice(0, 8)} [${st.status}] ${st.title}`);
      }

      // Files
      try {
        const { listTaskFiles } = await import("../db/task-files.js");
        const files = listTaskFiles(task.id);
        if (files.length > 0) {
          lines.push(`\nFiles (${files.length}):`);
          for (const f of files) lines.push(`  ${(f as any).role || "file"}: ${(f as any).path}`);
        }
      } catch {}

      // Commits
      try {
        const { getTaskCommits } = await import("../db/task-commits.js");
        const commits = getTaskCommits(task.id);
        if (commits.length > 0) {
          lines.push(`\nCommits (${commits.length}):`);
          for (const c of commits) lines.push(`  ${(c as any).commit_hash?.slice(0, 7)} ${(c as any).message || ""}`);
        }
      } catch {}

      if (task.comments.length > 0) {
        lines.push(`\nComments (${task.comments.length}):`);
        for (const c of task.comments) lines.push(`  [${c.agent_id || "?"}] ${c.created_at}: ${c.content}`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// get_context — compact text for agent prompt injection
if (shouldRegisterTool("get_context")) {
server.tool(
  "get_context",
  "Get a compact task summary for agent prompt injection. Returns formatted text.",
  {
    agent_id: z.string().optional(),
    project_id: z.string().optional(),
    format: z.enum(["text", "compact"]).optional(),
  },
  async ({ agent_id, project_id, format: _format }) => {
    try {
      const filters: any = {};
      if (project_id) filters.project_id = resolveId(project_id, "projects");
      const status = getStatus(Object.keys(filters).length > 0 ? filters : undefined, agent_id);
      const next = getNextTask(agent_id, Object.keys(filters).length > 0 ? filters : undefined);
      const lines: string[] = [];
      lines.push(`Tasks: ${status.pending} pending | ${status.in_progress} active | ${status.completed} done`);
      if (status.stale_count > 0) lines.push(`⚠ ${status.stale_count} stale tasks`);
      if (status.overdue_recurring > 0) lines.push(`🔁 ${status.overdue_recurring} overdue recurring`);
      if (status.active_work.length > 0) {
        const active = status.active_work.slice(0, 3).map(w => `${w.short_id || w.id.slice(0, 8)} (${w.assigned_to || '?'})`).join(", ");
        lines.push(`Active: ${active}`);
      }
      if (next) lines.push(`Next up: ${next.short_id || next.id.slice(0, 8)} [${next.priority}] ${next.title}`);
      // Include timestamp so agents can use get_tasks_changed_since for incremental polling
      lines.push(`as_of: ${new Date().toISOString()}`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// bootstrap — single session-start call
if (shouldRegisterTool("bootstrap")) {
server.tool(
  "bootstrap",
  "Single call for session start. Returns agent's in-progress task (if resuming), next claimable task, and project health — no side effects. Replaces 3-4 round trips at cold start.",
  {
    agent_id: z.string().optional().describe("Your agent ID — used to find your active tasks and preferred next task"),
    project_id: z.string().optional(),
  },
  async ({ agent_id, project_id }) => {
    try {
      const filters: any = {};
      if (project_id) filters.project_id = resolveId(project_id, "projects");
      const f = Object.keys(filters).length > 0 ? filters : undefined;

      const status = getStatus(f, agent_id);
      const next = getNextTask(agent_id, f);

      const lines: string[] = [];

      // 1. Agent's own in-progress task (resuming context)
      const myActive = agent_id
        ? status.active_work.filter(w => w.assigned_to === agent_id || w.locked_by === agent_id)
        : [];
      if (myActive.length > 0) {
        lines.push(`## Resuming`);
        for (const w of myActive) {
          lines.push(`[${w.short_id || w.id.slice(0, 8)}] ${w.priority} — ${w.title}`);
        }
        lines.push("");
      }

      // 2. Next claimable task
      if (next) {
        lines.push(`## Next task to claim`);
        lines.push(`[${next.short_id || next.id.slice(0, 8)}] ${next.priority} — ${next.title}`);
        if (next.description) lines.push(next.description.slice(0, 300) + (next.description.length > 300 ? "…" : ""));
        lines.push(`  call: claim_next_task(agent_id: "${agent_id || "<your-id>"}")`);
        lines.push("");
      } else {
        lines.push(`## No tasks available to claim`);
        lines.push("");
      }

      // 3. Project health (3 lines)
      lines.push(`## Health`);
      lines.push(`${status.pending} pending | ${status.in_progress} active | ${status.completed} done`);
      if (status.stale_count > 0) lines.push(`⚠ ${status.stale_count} stale task(s)`);
      if (status.overdue_recurring > 0) lines.push(`🔁 ${status.overdue_recurring} overdue recurring`);
      if (status.active_work.length > 0) {
        const others = agent_id
          ? status.active_work.filter(w => w.assigned_to !== agent_id && w.locked_by !== agent_id)
          : status.active_work;
        if (others.length > 0) {
          lines.push(`Other agents active: ${others.slice(0, 3).map(w => `${w.short_id || w.id.slice(0, 8)} (${w.assigned_to || '?'})`).join(", ")}`);
        }
      }

      // 4. Project sources (if project_id provided)
      if (project_id) {
        const resolvedId = resolveId(project_id, "projects");
        const sources = listProjectSources(resolvedId);
        if (sources.length > 0) {
          lines.push("");
          lines.push(`## Data Sources`);
          for (const s of sources) {
            lines.push(`[${s.type}] ${s.name}: ${s.uri}${s.description ? ` — ${s.description}` : ""}`);
          }
        }
      }

      lines.push(`\nas_of: ${new Date().toISOString()}`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// redistribute_stale_tasks
if (shouldRegisterTool("redistribute_stale_tasks")) {
server.tool(
  "redistribute_stale_tasks",
  "Release stale in-progress tasks and optionally claim the best one. Work-stealing for multi-agent.",
  {
    agent_id: z.string().describe("Agent ID claiming the next task after releasing stale ones"),
    max_age_minutes: z.number().optional().describe("Tasks idle longer than this (default: 60) are released"),
    project_id: z.string().optional().describe("Limit to a specific project"),
    limit: z.number().optional().describe("Max number of stale tasks to release"),
  },
  async ({ agent_id, max_age_minutes, project_id, limit }) => {
    try {
      const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
      const result = redistributeStaleTasks(agent_id, { max_age_minutes, project_id: resolvedProjectId, limit });
      const lines = [`Released ${result.released.length} stale task(s).`];
      for (const t of result.released) lines.push(`  ${formatTask(t)}`);
      if (result.claimed) lines.push(`\nClaimed: ${formatTask(result.claimed)}`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// === FAILURE TASKS ===

if (shouldRegisterTool("create_failure_task")) {
server.tool(
  "create_failure_task",
  "Create a task from a test/build/typecheck failure. Auto-assigns to the most likely agent based on file ownership and org chart.",
  {
    failure_type: z.enum(["test", "build", "typecheck", "runtime", "other"]).describe("Type of failure"),
    title: z.string().optional().describe("Task title (auto-generated from error if omitted)"),
    error_message: z.string().describe("The error message or summary"),
    file_path: z.string().optional().describe("File where the failure occurred"),
    stack_trace: z.string().optional().describe("Stack trace or detailed output (truncated to 2000 chars)"),
    project_id: z.string().optional().describe("Project to associate the task with"),
    priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Default: high for build/typecheck, medium for test"),
  },
  async ({ failure_type, title, error_message, file_path, stack_trace, project_id, priority }) => {
    try {
      const { createTask } = require("../db/tasks.js") as any;
      const { autoAssignTask } = await import("../lib/auto-assign.js");

      const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
      const defaultPriority = (failure_type === "build" || failure_type === "typecheck") ? "high" : "medium";
      const taskPriority = priority ?? defaultPriority;

      const autoTitle = title || `${failure_type.toUpperCase()} failure${file_path ? ` in ${file_path.split("/").pop()}` : ""}: ${error_message.slice(0, 60)}`;
      const description = [
        `**Failure type:** ${failure_type}`,
        file_path ? `**File:** ${file_path}` : null,
        `**Error:**\n\`\`\`\n${error_message.slice(0, 500)}\n\`\`\``,
        stack_trace ? `**Stack trace:**\n\`\`\`\n${stack_trace.slice(0, 1500)}\n\`\`\`` : null,
      ].filter(Boolean).join("\n\n");

      const task = createTask({
        title: autoTitle,
        description,
        priority: taskPriority,
        project_id: resolvedProjectId,
        tags: ["failure", failure_type, "auto-created"],
        status: "pending",
      });

      // Auto-assign using Cerebras/capability routing
      const assignResult = await autoAssignTask(task.id);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ task_id: task.id, short_id: task.short_id, title: task.title, assigned_to: assignResult.agent_name, assign_method: assignResult.method }, null, 2),
        }],
      };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// === AUTO-ASSIGN ===

if (shouldRegisterTool("auto_assign_task")) {
server.tool(
  "auto_assign_task",
  "Auto-assign a task to the best available agent. Uses Cerebras LLM (llama-3.3-70b) if CEREBRAS_API_KEY is set, otherwise falls back to capability-based matching.",
  {
    task_id: z.string().describe("Task to auto-assign"),
  },
  async ({ task_id }) => {
    try {
      const { autoAssignTask } = await import("../lib/auto-assign.js");
      const resolvedId = resolveId(task_id);
      const result = await autoAssignTask(resolvedId);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

if (shouldRegisterTool("auto_assign_unassigned")) {
server.tool(
  "auto_assign_unassigned",
  "Auto-assign all unassigned pending tasks in a project using Cerebras LLM routing. Returns summary of assignments made.",
  {
    project_id: z.string().optional().describe("Filter to a specific project"),
    limit: z.number().optional().describe("Max tasks to assign (default: 20)"),
  },
  async ({ project_id, limit }) => {
    try {
      const { autoAssignTask } = await import("../lib/auto-assign.js");
      const { listTasks } = require("../db/tasks.js") as any;
      const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
      const tasks = listTasks({
        status: "pending",
        project_id: resolvedProjectId,
      }).tasks.filter((t: any) => !t.assigned_to).slice(0, limit ?? 20);

      const results = [];
      for (const task of tasks) {
        try {
          const r = await autoAssignTask(task.id);
          results.push(r);
        } catch { /* continue */ }
      }

      const assigned = results.filter(r => r.assigned_to);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            total_checked: tasks.length,
            assigned: assigned.length,
            skipped: tasks.length - assigned.length,
            results,
          }, null, 2),
        }],
      };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// === META TOOLS ===

// search_tools
if (shouldRegisterTool("search_tools")) {
server.tool(
  "search_tools",
  "List all tool names, optionally filtered by substring.",
  { query: z.string().optional() },
  async ({ query }) => {
    const all = [
      "create_task","list_tasks","get_task","update_task","delete_task",
      "start_task","complete_task","fail_task","lock_task","unlock_task","approve_task",
      "add_dependency","remove_dependency","add_comment","log_progress",
      "create_project","list_projects","add_project_source","remove_project_source","list_project_sources",
      "add_checklist_item","check_checklist_item","update_checklist_item","remove_checklist_item","get_checklist",
      "create_plan","list_plans","get_plan","update_plan","delete_plan",
      "register_agent","suggest_agent_name","list_agents","get_agent","rename_agent","delete_agent","unarchive_agent","heartbeat","release_agent",
      "get_my_tasks","get_org_chart","set_reports_to",
      "create_task_list","list_task_lists","get_task_list","update_task_list","delete_task_list",
      "search_tasks","sync","clone_task","move_task","get_next_task","claim_next_task",
      "get_task_history","get_recent_activity","recap","task_context","standup","burndown","blame","import_github_issue",
      "create_webhook","list_webhooks","delete_webhook",
      "create_template","list_templates","create_task_from_template","delete_template",
      "bulk_update_tasks","bulk_create_tasks","get_task_stats","get_task_graph",
      "get_active_work","get_tasks_changed_since","get_stale_tasks","get_status","get_context","get_health","bootstrap",
      "decompose_task",
      "set_task_status","set_task_priority",
      "redistribute_stale_tasks",
      "search_tools","describe_tools",
    ].filter(name => shouldRegisterTool(name));
    const q = query?.toLowerCase();
    const matches = q ? all.filter(n => n.includes(q)) : all;
    return { content: [{ type: "text" as const, text: matches.join(", ") }] };
  },
);
}

// describe_tools
if (shouldRegisterTool("describe_tools")) {
server.tool(
  "describe_tools",
  "Get detailed parameter info for specific tools by name.",
  { names: z.array(z.string()) },
  async ({ names }) => {
    const descriptions: Record<string, string> = {
      // Task CRUD
      create_task: "Create a new task.\n  Params: title(string, req), description(string), priority(low|medium|high|critical, default:medium), status(pending|in_progress|completed|failed|cancelled, default:pending), project_id(string), parent_id(string — creates subtask), plan_id(string), task_list_id(string), agent_id(string), assigned_to(string), tags(string[]), metadata(object), estimated_minutes(number), requires_approval(boolean), recurrence_rule(string — e.g. 'every day', 'every weekday', 'every 2 weeks', 'every monday'), session_id(string), working_dir(string)\n  Example: {title: 'Daily standup', recurrence_rule: 'every weekday', priority: 'medium'}",
      list_tasks: "List tasks with optional filters. Default limit is 50 to avoid context overflow — always paginate with offset for large lists.\n  Params: status(string|string[]), priority(string|string[]), project_id(string), plan_id(string), task_list_id(string), assigned_to(string), tags(string[]), has_recurrence(boolean — true=only recurring, false=only non-recurring), limit(number, default 50), offset(number)\n  Example: {status: ['pending', 'in_progress'], limit: 50, offset: 0}",
      get_task: "Get full task details with subtasks, deps, and comments.\n  Params: id(string, req — task ID, short_id like 'APP-00001', or partial ID)\n  Example: {id: 'a1b2c3d4'}",
      update_task: "Update task fields. Requires version for optimistic locking (get it from get_task first).\n  Params: id(string, req), version(number, req), title(string), description(string), status(pending|in_progress|completed|failed|cancelled), priority(low|medium|high|critical), assigned_to(string), tags(string[]), metadata(object), plan_id(string), task_list_id(string)\n  Example: {id: 'a1b2c3d4', version: 3, status: 'completed'}",
      delete_task: "Delete a task permanently. Subtasks cascade-delete. Dependencies removed.\n  Params: id(string, req)\n  Example: {id: 'a1b2c3d4'}",

      // Task workflow
      start_task: "Claim, lock, and set task status to in_progress in one call.\n  Params: id(string, req), agent_id(string, req — your 8-char agent ID)\n  Example: {id: 'a1b2c3d4', agent_id: 'e5f6g7h8'}",
      complete_task: "Mark task completed, release lock, set completed_at timestamp. For recurring tasks, auto-spawns next instance unless skip_recurrence is true.\n  Params: id(string, req), agent_id(string, optional — required if locked by different agent), skip_recurrence(boolean — set true to prevent auto-creating next recurring instance)\n  Example: {id: 'a1b2c3d4', skip_recurrence: false}",
      lock_task: "Acquire exclusive lock on a task. Locks auto-expire after 30 min. Re-locking by same agent is idempotent.\n  Params: id(string, req), agent_id(string, req)\n  Example: {id: 'a1b2c3d4', agent_id: 'e5f6g7h8'}",
      unlock_task: "Release exclusive lock on a task.\n  Params: id(string, req), agent_id(string, optional — omit to force-unlock)\n  Example: {id: 'a1b2c3d4', agent_id: 'e5f6g7h8'}",
      approve_task: "Approve a task with requires_approval=true. Must be approved before completion.\n  Params: id(string, req), agent_id(string, optional — defaults to 'system')\n  Example: {id: 'a1b2c3d4', agent_id: 'e5f6g7h8'}",
      fail_task: "Mark a task as failed with structured reason and optional auto-retry. Stores failure info in metadata._failure, releases lock.\n  Params: id(string, req), agent_id(string, optional), reason(string), error_code(string — e.g. 'TIMEOUT'), retry(boolean — create new pending copy), retry_after(ISO date)\n  Example: {id: 'a1b2c3d4', reason: 'Build timeout', error_code: 'TIMEOUT', retry: true}",

      // Dependencies & comments
      add_dependency: "Add a dependency: task_id depends on depends_on. Prevents cycles via BFS.\n  Params: task_id(string, req), depends_on(string, req)\n  Example: {task_id: 'abc12345', depends_on: 'def67890'}",
      remove_dependency: "Remove a dependency link between two tasks.\n  Params: task_id(string, req), depends_on(string, req)\n  Example: {task_id: 'abc12345', depends_on: 'def67890'}",
      add_comment: "Add a comment/note to a task. Comments are append-only.\n  Params: task_id(string, req), content(string, req), agent_id(string), session_id(string)\n  Example: {task_id: 'a1b2c3d4', content: 'Blocked by API rate limit'}",
      log_progress: "Record intermediate work progress on a task with optional percent complete.\n  Params: task_id(string, req), message(string, req), pct_complete(number 0-100), agent_id(string)\n  Example: {task_id: 'a1b2c3d4', message: 'Completed DB schema', pct_complete: 40}",

      // Projects
      create_project: "Register a new project. Auto-generates task prefix for short IDs (e.g. APP-00001).\n  Params: name(string, req), path(string, req — unique absolute path), description(string), task_list_id(string)\n  Example: {name: 'my-app', path: '/Users/dev/my-app'}",
      list_projects: "List all registered projects. No params.",
      // Checklists
      add_checklist_item: "Add a checklist item (numbered sub-step) to a task.\n  Params: task_id(string, req), text(string, req), position(number — 0-based, appended to end if omitted)\n  Example: {task_id: 'a1b2c3d4', text: 'Cancel Slack subscription'}",
      check_checklist_item: "Mark a checklist item checked or unchecked.\n  Params: item_id(string, req — item ID or prefix), checked(boolean, req)\n  Example: {item_id: 'abc12345', checked: true}",
      update_checklist_item: "Update the text of a checklist item.\n  Params: item_id(string, req), text(string, req)\n  Example: {item_id: 'abc12345', text: 'Cancel GitHub subscription'}",
      remove_checklist_item: "Remove a checklist item permanently.\n  Params: item_id(string, req)\n  Example: {item_id: 'abc12345'}",
      get_checklist: "Get all checklist items for a task with progress (done/total).\n  Params: task_id(string, req)\n  Example: {task_id: 'a1b2c3d4'}",

      add_project_source: "Add a data source to a project (S3, GDrive, local path, GitHub, Notion, HTTP, etc.).\n  Params: project_id(string, req), type(string, req — e.g. 's3','gdrive','local','github','notion','http'), name(string, req), uri(string, req), description(string), metadata(object)\n  Example: {project_id: 'a1b2c3d4', type: 's3', name: 'Assets bucket', uri: 's3://my-bucket/assets/', description: 'Project media files'}",
      remove_project_source: "Remove a data source from a project.\n  Params: source_id(string, req — source ID or prefix)\n  Example: {source_id: 'abc12345'}",
      list_project_sources: "List all data sources for a project.\n  Params: project_id(string, req)\n  Example: {project_id: 'a1b2c3d4'}",

      // Plans
      create_plan: "Create a plan to group related tasks.\n  Params: name(string, req), project_id(string), description(string), status(active|completed|archived, default:active), task_list_id(string), agent_id(string)\n  Example: {name: 'Sprint 1', project_id: 'a1b2c3d4'}",
      list_plans: "List all plans, optionally filtered by project.\n  Params: project_id(string)\n  Example: {project_id: 'a1b2c3d4'}",
      get_plan: "Get plan details (name, status, description, timestamps).\n  Params: id(string, req)\n  Example: {id: 'a1b2c3d4'}",
      update_plan: "Update plan fields.\n  Params: id(string, req), name(string), description(string), status(active|completed|archived), task_list_id(string), agent_id(string)\n  Example: {id: 'a1b2c3d4', status: 'completed'}",
      delete_plan: "Delete a plan. Tasks in the plan are orphaned, not deleted.\n  Params: id(string, req)\n  Example: {id: 'a1b2c3d4'}",

      // Agents
      suggest_agent_name: "Check available agent names before registering. Shows active agents and, if a pool is configured, which pool names are free.\n  Params: working_dir(string — your working directory, used to look up project pool from config)\n  Example: {working_dir: '/workspace/platform'}",
      register_agent: "Register an agent. Any name is allowed — pool is advisory. Returns CONFLICT if name is held by a recently-active agent. Use force:true to take over.\n  Params: name(string, req), description(string), capabilities(string[]), session_id(string — unique per session), working_dir(string — used to determine project pool), force(boolean — skip conflict check)\n  Example: {name: 'my-agent', session_id: 'abc123-1741952000', working_dir: '/workspace/platform'}",
      list_agents: "List all registered agents (active by default). Set include_archived: true to see archived agents.\n  Params: include_archived(boolean, optional)\n  Example: {include_archived: true}",
      get_agent: "Get agent details by ID or name. Provide one of id or name.\n  Params: id(string), name(string)\n  Example: {name: 'maximus'}",
      rename_agent: "Rename an agent. Resolve by id or current name.\n  Params: id(string), name(string — current name), new_name(string, req)\n  Example: {name: 'old-name', new_name: 'new-name'}",
      delete_agent: "Archive an agent (soft delete). Agent is preserved for task history but hidden from list_agents. Use unarchive_agent to restore.\n  Params: id(string), name(string)\n  Example: {name: 'maximus'}",
      unarchive_agent: "Restore an archived agent back to active status.\n  Params: id(string), name(string)\n  Example: {name: 'maximus'}",
      heartbeat: "Update last_seen_at timestamp to signal you're still active. Call periodically during long tasks.\n  Params: agent_id(string, req — your agent ID or name)\n  Example: {agent_id: 'maximus'}",
      release_agent: "Explicitly release/logout an agent — clears session binding and makes name immediately available. Call when session ends.\n  Params: agent_id(string, req), session_id(string — only releases if matching)\n  Example: {agent_id: 'maximus', session_id: 'my-session-123'}",
      get_my_tasks: "Get all tasks assigned to/created by an agent, with stats (pending/active/done/rate).\n  Params: agent_name(string, req)\n  Example: {agent_name: 'maximus'}",
      get_org_chart: "Get agent org chart showing reporting hierarchy. No params.",
      set_reports_to: "Set who an agent reports to in the org chart. Omit manager_name for top-level.\n  Params: agent_name(string, req), manager_name(string, optional)\n  Example: {agent_name: 'brutus', manager_name: 'maximus'}",

      // Task lists
      create_task_list: "Create a task list — a container/folder for organizing tasks.\n  Params: name(string, req), slug(string — auto-generated if omitted), project_id(string), description(string)\n  Example: {name: 'Sprint 1', project_id: 'a1b2c3d4'}",
      list_task_lists: "List all task lists, optionally filtered by project.\n  Params: project_id(string)\n  Example: {project_id: 'a1b2c3d4'}",
      get_task_list: "Get task list details (name, slug, project, metadata).\n  Params: id(string, req)\n  Example: {id: 'a1b2c3d4'}",
      update_task_list: "Update a task list's name or description.\n  Params: id(string, req), name(string), description(string)\n  Example: {id: 'a1b2c3d4', name: 'Sprint 2'}",
      delete_task_list: "Delete a task list. Tasks are orphaned (not deleted).\n  Params: id(string, req)\n  Example: {id: 'a1b2c3d4'}",

      // Search & sync
      search_tasks: "Full-text search across task titles, descriptions, and tags. Supports filters.\n  Params: query(string, req), project_id(string), task_list_id(string), status(string|string[]), priority(string|string[]), assigned_to(string), agent_id(string), created_after(ISO date), updated_after(ISO date), has_dependencies(boolean), is_blocked(boolean)\n  Example: {query: 'auth bug', status: 'pending'}",
      get_next_task: "Get the optimal next task to work on — finds highest-priority pending task that is not blocked or locked. Prefers tasks assigned to the given agent.\n  Params: agent_id(string — prefers your tasks), project_id(string), task_list_id(string), plan_id(string), tags(string[])\n  Example: {agent_id: 'a1b2c3d4', project_id: 'e5f6g7h8'}",
      claim_next_task: "Atomically find the best pending task, lock it, and start it — one call instead of get_next_task + start_task. Eliminates race conditions between agents.\n  Params: agent_id(string, req — used for lock and assignment), project_id(string), task_list_id(string), plan_id(string), tags(string[])\n  Example: {agent_id: 'a1b2c3d4', project_id: 'e5f6g7h8'}",
      sync: "Sync tasks between local DB and agent task list (e.g. Claude Code).\n  Params: agent(string, default:'claude'), task_list_id(string), all_agents(boolean), project_id(string), direction(push|pull|both, default:both), prefer(local|remote, default:remote)\n  Example: {agent: 'claude', direction: 'push'}",

      // Bulk operations
      clone_task: "Duplicate a task with optional field overrides. Creates new independent copy.\n  Params: task_id(string, req), title(string), description(string), priority(low|medium|high|critical), status(pending|in_progress|completed|failed|cancelled), project_id(string), plan_id(string), task_list_id(string), assigned_to(string), tags(string[]), estimated_minutes(number)\n  Example: {task_id: 'a1b2c3d4', title: 'Cloned task', assigned_to: 'brutus'}",
      move_task: "Move a task to a different list, project, or plan.\n  Params: task_id(string, req), task_list_id(string|null), project_id(string|null), plan_id(string|null)\n  Example: {task_id: 'a1b2c3d4', task_list_id: 'e5f6g7h8'}",
      bulk_update_tasks: "Update multiple tasks at once. Two modes:\n  Mode 1 (same fields to all): task_ids(string[], req), status, priority, assigned_to, tags\n  Mode 2 (per-task fields): updates([{id, status?, priority?, assigned_to?, tags?, title?, description?, plan_id?, task_list_id?}], req)\n  Example mode 1: {task_ids: ['abc12345', 'def67890'], assigned_to: 'agent-id'}\n  Example mode 2: {updates: [{id: 'abc12345', assigned_to: 'agent-1'}, {id: 'def67890', status: 'in_progress'}]}",
      bulk_create_tasks: "Create multiple tasks atomically. Supports inter-task dependencies via temp_id references.\n  Params: tasks(array, req — [{temp_id, title, description, priority, status, project_id, plan_id, task_list_id, agent_id, assigned_to, tags, estimated_minutes, depends_on_temp_ids}]), project_id(string — default for all), plan_id(string — default for all), task_list_id(string — default for all)\n  Example: {tasks: [{temp_id: 'a', title: 'First'}, {temp_id: 'b', title: 'Second', depends_on_temp_ids: ['a']}]}",

      // Analytics
      get_task_stats: "Get task analytics: counts by status, priority, agent, and completion rate. All via SQL.\n  Params: project_id(string), task_list_id(string), agent_id(string)\n  Example: {project_id: 'a1b2c3d4'}",
      get_task_graph: "Get full dependency tree for a task — upstream blockers and downstream dependents.\n  Params: id(string, req), direction(up|down|both, default:both)\n  Example: {id: 'a1b2c3d4', direction: 'up'}",

      // Audit
      get_task_history: "Get audit log for a task — all field changes with timestamps and actors.\n  Params: task_id(string, req)\n  Example: {task_id: 'a1b2c3d4'}",
      get_recent_activity: "Get recent task changes across all tasks — global activity feed.\n  Params: limit(number, default:50)\n  Example: {limit: 20}",
      recap: "Summary of what happened in the last N hours — completed tasks with durations, new tasks, in-progress, blocked, stale, agent activity.\n  Params: hours(number, default:8), project_id(string)\n  Example: {hours: 4}",
      task_context: "Full orientation for a specific task — description, dependencies with blocked status, files, commits, comments, checklist, duration. Use before starting work.\n  Params: id(string, req)\n  Example: {id: 'OPE-00042'}",
      standup: "Generate standup notes — completed tasks grouped by agent, in-progress, blocked. Copy-paste ready.\n  Params: hours(number, default:24), project_id(string)\n  Example: {hours: 24}",
      import_github_issue: "Import a GitHub issue as a task. Requires gh CLI.\n  Params: url(string, req), project_id(string), task_list_id(string)\n  Example: {url: 'https://github.com/owner/repo/issues/42'}",
      blame: "Show which tasks/agents touched a file — combines task_files and task_commits.\n  Params: path(string, req)\n  Example: {path: 'src/db/agents.ts'}",
      burndown: "ASCII burndown chart — actual vs ideal progress for a plan, project, or task list.\n  Params: plan_id(string), project_id(string), task_list_id(string)\n  Example: {plan_id: 'abc123'}",

      // Webhooks
      create_webhook: "Register a webhook for task change events.\n  Params: url(string, req), events(string[] — empty=all), secret(string — HMAC signing)\n  Example: {url: 'https://example.com/hook', events: ['task.created', 'task.completed']}",
      list_webhooks: "List all registered webhooks. No params.",
      delete_webhook: "Delete a webhook by ID.\n  Params: id(string, req)\n  Example: {id: 'a1b2c3d4'}",

      // Templates
      create_template: "Create a reusable task template.\n  Params: name(string, req), title_pattern(string, req — e.g. 'Fix: {description}'), description(string), priority(low|medium|high|critical), tags(string[]), project_id(string), plan_id(string)\n  Example: {name: 'Bug Report', title_pattern: 'Bug: {description}', priority: 'high', tags: ['bug']}",
      list_templates: "List all task templates. No params.",
      create_task_from_template: "Create a task from a template with optional overrides.\n  Params: template_id(string, req), title(string), description(string), priority(low|medium|high|critical), assigned_to(string), project_id(string)\n  Example: {template_id: 'a1b2c3d4', assigned_to: 'maximus'}",
      delete_template: "Delete a task template.\n  Params: id(string, req)\n  Example: {id: 'a1b2c3d4'}",

      // Active work
      get_active_work: "See all in-progress tasks and who is working on them.\n  Params: project_id(string, optional), task_list_id(string, optional)\n  Example: {project_id: 'a1b2c3d4'}",
      get_tasks_changed_since: "PREFERRED POLLING PATTERN: Get only tasks modified after a timestamp — much cheaper than re-fetching everything. Save the as_of timestamp from bootstrap/get_status/get_context and pass it here on your next check.\n  Params: since(string, req — ISO date from prior as_of), project_id(string, optional), task_list_id(string, optional)\n  Example: {since: '2026-03-14T10:00:00Z'}",
      get_stale_tasks: "Find stale in_progress tasks with no recent activity.\n  Params: stale_minutes(number, default:30), project_id(string, optional), task_list_id(string, optional)\n  Example: {stale_minutes: 60, project_id: 'a1b2c3d4'}",
      get_status: "Get a full project health snapshot — pending/in_progress/completed counts, active work, next recommended task, stale task count, overdue recurring tasks. Saves 4+ round trips at session start.\n  Params: agent_id(string, optional — prefers tasks assigned to this agent for next_task), project_id(string, optional), task_list_id(string, optional)\n  Example: {agent_id: 'a1b2c3d4', project_id: 'e5f6g7h8'}",
      bootstrap: "CALL THIS FIRST at session start. Returns your in-progress task (if resuming), next claimable task with description, and project health — all in one call, no side effects. Eliminates 3-4 round trips.\n  Params: agent_id(string, optional but recommended), project_id(string, optional)\n  Example: {agent_id: 'a1b2c3d4'}",

      // Decompose
      decompose_task: "Break a task into subtasks in one call. Subtasks inherit project/plan/list from parent.\n  Params: parent_id(string, req), subtasks(array, req — [{title, description, priority, assigned_to, estimated_minutes, tags}]), depends_on_prev(boolean — chain subtasks sequentially)\n  Example: {parent_id: 'a1b2c3d4', subtasks: [{title: 'Research'}, {title: 'Implement'}, {title: 'Test'}], depends_on_prev: true}",

      // Version-free shortcuts
      set_task_status: "Set task status without needing version. Auto-retries on conflict (up to 3 attempts). Use instead of update_task when you only need to change status.\n  Params: id(string, req), status(pending|in_progress|completed|failed|cancelled, req), agent_id(string)\n  Example: {id: 'a1b2c3d4', status: 'completed'}",
      set_task_priority: "Set task priority without needing version. Auto-retries on conflict (up to 3 attempts). Use instead of update_task when you only need to change priority.\n  Params: id(string, req), priority(low|medium|high|critical, req)\n  Example: {id: 'a1b2c3d4', priority: 'high'}",

      // Work-stealing
      redistribute_stale_tasks: "Release stale in-progress tasks and optionally claim the best one. Multi-agent work-stealing.\n  Params: agent_id(string, req), max_age_minutes(number, default:60), project_id(string, optional), limit(number, optional)\n  Example: {agent_id: 'a1b2c3d4', max_age_minutes: 30}",

      // Meta
      search_tools: "List all tool names or filter by substring.\n  Params: query(string, optional)\n  Example: {query: 'task'}",
      describe_tools: "Get detailed descriptions and parameter info for tools by name.\n  Params: names(string[], req)\n  Example: {names: ['create_task', 'update_task']}",
    };
    const allToolNames = Object.keys(descriptions);
    const registeredCount = allToolNames.filter(n => shouldRegisterTool(n)).length;
    const profileLine = `Profile: ${TODOS_PROFILE} (${registeredCount} tools active)\n\n`;
    const result = names.map(n => `${n}: ${descriptions[n] || "Unknown tool. Use search_tools to list available tools."}`).join("\n\n");
    return { content: [{ type: "text" as const, text: profileLine + result }] };
  },
);
}

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

// === TASK FILES ===

if (shouldRegisterTool("add_task_file")) {
server.tool(
  "add_task_file",
  "Link a file path to a task. Tracks which files an agent is working on. Upserts if same task+path exists. Auto-detects conflicts with other in-progress tasks.",
  {
    task_id: z.string().describe("Task ID"),
    path: z.string().describe("File path (relative or absolute)"),
    paths: z.array(z.string()).optional().describe("Multiple file paths to add at once"),
    status: z.enum(["planned", "active", "modified", "reviewed", "removed"]).optional().describe("File status (default: active)"),
    agent_id: z.string().optional().describe("Agent working on this file"),
    note: z.string().optional().describe("Note about why this file is linked"),
  },
  async ({ task_id, path, paths: multiplePaths, status, agent_id, note }) => {
    try {
      const { addTaskFile, bulkAddTaskFiles, detectFileConflicts } = require("../db/task-files.js") as any;
      const resolvedId = resolveId(task_id);

      let addedFiles: any[];
      if (multiplePaths && multiplePaths.length > 0) {
        const allPaths = path ? [path, ...multiplePaths] : multiplePaths;
        addedFiles = bulkAddTaskFiles(resolvedId, allPaths, agent_id);
        const conflicts = detectFileConflicts(resolvedId, allPaths);
        if (conflicts.length > 0) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                added: addedFiles.length,
                conflicts,
                warning: `${conflicts.length} file(s) already claimed by other in-progress tasks`,
              }, null, 2),
            }],
          };
        }
        return { content: [{ type: "text" as const, text: `${addedFiles.length} file(s) linked to task ${resolvedId.slice(0, 8)}` }] };
      }

      const file = addTaskFile({ task_id: resolvedId, path, status, agent_id, note });
      const conflicts = detectFileConflicts(resolvedId, [path]);
      if (conflicts.length > 0) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              file,
              conflicts,
              warning: `${path} is already claimed by another in-progress task`,
            }, null, 2),
          }],
        };
      }
      return { content: [{ type: "text" as const, text: `${file.status} ${file.path} → task ${resolvedId.slice(0, 8)}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("list_task_files")) {
server.tool(
  "list_task_files",
  "List all files linked to a task.",
  { task_id: z.string().describe("Task ID") },
  async ({ task_id }) => {
    try {
      const { listTaskFiles } = require("../db/task-files.js") as any;
      const resolvedId = resolveId(task_id);
      const files: any[] = listTaskFiles(resolvedId);
      if (files.length === 0) return { content: [{ type: "text" as const, text: "No files linked." }] };
      const lines = files.map((f: any) => `[${f.status}] ${f.path}${f.agent_id ? ` (${f.agent_id})` : ""}${f.note ? ` — ${f.note}` : ""}`);
      return { content: [{ type: "text" as const, text: `${files.length} file(s):\n${lines.join("\n")}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("find_tasks_by_file")) {
server.tool(
  "find_tasks_by_file",
  "Find which tasks are linked to a specific file path. Shows who's working on what files.",
  { path: z.string().describe("File path to search for") },
  async ({ path }) => {
    try {
      const { findTasksByFile } = require("../db/task-files.js") as any;
      const files: any[] = findTasksByFile(path);
      if (files.length === 0) return { content: [{ type: "text" as const, text: `No tasks linked to ${path}` }] };
      const lines = files.map((f: any) => `${f.task_id.slice(0, 8)} [${f.status}]${f.agent_id ? ` (${f.agent_id})` : ""}`);
      return { content: [{ type: "text" as const, text: `${files.length} task(s) linked to ${path}:\n${lines.join("\n")}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("get_file_heat_map")) {
server.tool(
  "get_file_heat_map",
  "Aggregate file edit frequency across all tasks and agents. Returns hottest files with edit count, unique agents, and last edit. Hot files = high coordination risk, good candidates for extra test coverage.",
  {
    limit: z.number().optional().describe("Max files to return (default: 20)"),
    project_id: z.string().optional().describe("Filter to a specific project"),
    min_edits: z.number().optional().describe("Minimum edit count to include (default: 1)"),
  },
  async ({ limit, project_id, min_edits }) => {
    try {
      const { getFileHeatMap } = require("../db/task-files.js") as any;
      const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
      const results = getFileHeatMap({ limit, project_id: resolvedProjectId, min_edits });
      return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

if (shouldRegisterTool("bulk_find_tasks_by_files")) {
server.tool(
  "bulk_find_tasks_by_files",
  "Check multiple file paths at once for task/agent collisions. Returns per-path task list, in-progress count, and conflict flag.",
  {
    paths: z.array(z.string()).describe("Array of file paths to check"),
  },
  async ({ paths }) => {
    try {
      const { bulkFindTasksByFiles } = require("../db/task-files.js") as any;
      const results = bulkFindTasksByFiles(paths);
      return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("list_active_files")) {
server.tool(
  "list_active_files",
  "Return all files linked to in-progress tasks across all agents — the bird's-eye view of what's being worked on right now.",
  {
    project_id: z.string().optional().describe("Filter by project"),
  },
  async ({ project_id }) => {
    try {
      const { listActiveFiles } = require("../db/task-files.js") as any;
      let files: any[] = listActiveFiles();
      if (project_id) {
        const pid = resolveId(project_id, "projects");
        // We need tasks with that project_id — re-query with filter
        const db = require("../db/database.js").getDatabase();
        files = db.query(`
          SELECT
            tf.path,
            tf.status AS file_status,
            tf.agent_id AS file_agent_id,
            tf.note,
            tf.updated_at,
            t.id AS task_id,
            t.short_id AS task_short_id,
            t.title AS task_title,
            t.status AS task_status,
            t.locked_by AS task_locked_by,
            t.locked_at AS task_locked_at,
            a.id AS agent_id,
            a.name AS agent_name
          FROM task_files tf
          JOIN tasks t ON tf.task_id = t.id
          LEFT JOIN agents a ON (tf.agent_id = a.id OR (tf.agent_id IS NULL AND t.assigned_to = a.id))
          WHERE t.status = 'in_progress'
            AND tf.status != 'removed'
            AND t.project_id = ?
          ORDER BY tf.updated_at DESC
        `).all(pid);
      }
      if (files.length === 0) {
        return { content: [{ type: "text" as const, text: "No active files — no in-progress tasks have linked files." }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(files, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// === TASK COMMITS ===

if (shouldRegisterTool("link_task_to_commit")) {
server.tool(
  "link_task_to_commit",
  "Link a git commit SHA to a task. Creates an audit trail: task → commits. Upserts on same task+sha.",
  {
    task_id: z.string().describe("Task ID"),
    sha: z.string().describe("Git commit SHA (full or short)"),
    message: z.string().optional().describe("Commit message"),
    author: z.string().optional().describe("Commit author"),
    files_changed: z.array(z.string()).optional().describe("Files changed in this commit"),
    committed_at: z.string().optional().describe("ISO timestamp of commit"),
  },
  async ({ task_id, sha, message, author, files_changed, committed_at }) => {
    try {
      const { linkTaskToCommit } = require("../db/task-commits.js") as any;
      const resolvedId = resolveId(task_id);
      const commit = linkTaskToCommit({ task_id: resolvedId, sha, message, author, files_changed, committed_at });
      return { content: [{ type: "text" as const, text: JSON.stringify(commit, null, 2) }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

if (shouldRegisterTool("get_task_commits")) {
server.tool(
  "get_task_commits",
  "Get all git commits linked to a task.",
  { task_id: z.string().describe("Task ID") },
  async ({ task_id }) => {
    try {
      const { getTaskCommits } = require("../db/task-commits.js") as any;
      const commits = getTaskCommits(resolveId(task_id));
      return { content: [{ type: "text" as const, text: JSON.stringify(commits, null, 2) }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

if (shouldRegisterTool("find_task_by_commit")) {
server.tool(
  "find_task_by_commit",
  "Find which task a git commit SHA is linked to. Supports prefix matching.",
  { sha: z.string().describe("Git commit SHA (full or short prefix)") },
  async ({ sha }) => {
    try {
      const { findTaskByCommit } = require("../db/task-commits.js") as any;
      const result = findTaskByCommit(sha);
      if (!result) return { content: [{ type: "text" as const, text: `No task linked to commit ${sha}` }] };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// === FILE LOCKS ===

if (shouldRegisterTool("lock_file")) {
server.tool(
  "lock_file",
  "Acquire an exclusive lock on a file path. Throws if another agent holds an active lock. Same agent re-locks refreshes the TTL.",
  {
    path: z.string().describe("File path to lock"),
    agent_id: z.string().describe("Agent acquiring the lock"),
    task_id: z.string().optional().describe("Task this lock is associated with"),
    ttl_seconds: z.number().optional().describe("Lock TTL in seconds (default: 1800 = 30 min)"),
  },
  async ({ path, agent_id, task_id, ttl_seconds }) => {
    try {
      const { lockFile } = require("../db/file-locks.js") as any;
      const lock = lockFile({ path, agent_id, task_id, ttl_seconds });
      return { content: [{ type: "text" as const, text: JSON.stringify(lock, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("unlock_file")) {
server.tool(
  "unlock_file",
  "Release a file lock. Only the lock holder can release it. Returns true if released.",
  {
    path: z.string().describe("File path to unlock"),
    agent_id: z.string().describe("Agent releasing the lock (must be the lock holder)"),
  },
  async ({ path, agent_id }) => {
    try {
      const { unlockFile } = require("../db/file-locks.js") as any;
      const released = unlockFile(path, agent_id);
      return { content: [{ type: "text" as const, text: JSON.stringify({ released, path }) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("check_file_lock")) {
server.tool(
  "check_file_lock",
  "Check who holds a lock on a file path. Returns null if unlocked or expired.",
  {
    path: z.string().describe("File path to check"),
  },
  async ({ path }) => {
    try {
      const { checkFileLock } = require("../db/file-locks.js") as any;
      const lock = checkFileLock(path);
      if (!lock) return { content: [{ type: "text" as const, text: JSON.stringify({ path, locked: false }) }] };
      return { content: [{ type: "text" as const, text: JSON.stringify({ path, locked: true, ...lock }) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("list_file_locks")) {
server.tool(
  "list_file_locks",
  "List all active file locks. Optionally filter by agent_id.",
  {
    agent_id: z.string().optional().describe("Filter locks by agent"),
  },
  async ({ agent_id }) => {
    try {
      const { listFileLocks } = require("../db/file-locks.js") as any;
      const locks = listFileLocks(agent_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(locks, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// === HANDOFFS ===

if (shouldRegisterTool("create_handoff")) {
server.tool(
  "create_handoff",
  "Create a session handoff note for agent coordination.",
  {
    agent_id: z.string().optional().describe("Agent creating the handoff"),
    project_id: z.string().optional().describe("Project ID"),
    summary: z.string().describe("What was accomplished this session"),
    completed: z.array(z.string()).optional().describe("Items completed"),
    in_progress: z.array(z.string()).optional().describe("Items still in progress"),
    blockers: z.array(z.string()).optional().describe("Blocking issues"),
    next_steps: z.array(z.string()).optional().describe("Recommended next actions"),
  },
  async ({ agent_id, project_id, summary, completed, in_progress, blockers, next_steps }) => {
    try {
      const { createHandoff } = require("../db/handoffs.js") as any;
      const handoff = createHandoff({
        agent_id, project_id: project_id ? resolveId(project_id, "projects") : undefined,
        summary, completed, in_progress, blockers, next_steps,
      });
      return { content: [{ type: "text" as const, text: `Handoff created: ${handoff.id.slice(0, 8)} by ${handoff.agent_id || "unknown"}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("get_latest_handoff")) {
server.tool(
  "get_latest_handoff",
  "Get the most recent handoff for an agent or project.",
  {
    agent_id: z.string().optional().describe("Filter by agent"),
    project_id: z.string().optional().describe("Filter by project"),
  },
  async ({ agent_id, project_id }) => {
    try {
      const { getLatestHandoff } = require("../db/handoffs.js") as any;
      const handoff = getLatestHandoff(agent_id, project_id ? resolveId(project_id, "projects") : undefined);
      if (!handoff) return { content: [{ type: "text" as const, text: "No handoffs found." }] };
      const lines = [
        `${handoff.created_at.slice(0, 16)} ${handoff.agent_id || "unknown"}`,
        handoff.summary,
      ];
      if (handoff.completed?.length) lines.push(`Done: ${handoff.completed.join(", ")}`);
      if (handoff.in_progress?.length) lines.push(`In progress: ${handoff.in_progress.join(", ")}`);
      if (handoff.blockers?.length) lines.push(`Blocked: ${handoff.blockers.join(", ")}`);
      if (handoff.next_steps?.length) lines.push(`Next: ${handoff.next_steps.join(", ")}`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// === TASK RELATIONSHIPS ===

if (shouldRegisterTool("add_task_relationship")) {
server.tool(
  "add_task_relationship",
  "Create a semantic relationship between two tasks (related_to, conflicts_with, similar_to, duplicates, supersedes, modifies_same_file).",
  {
    source_task_id: z.string().describe("Source task ID"),
    target_task_id: z.string().describe("Target task ID"),
    relationship_type: z.enum(["related_to", "conflicts_with", "similar_to", "duplicates", "supersedes", "modifies_same_file"]).describe("Type of relationship"),
    created_by: z.string().optional().describe("Agent ID who created this relationship"),
  },
  async ({ source_task_id, target_task_id, relationship_type, created_by }) => {
    try {
      const { addTaskRelationship } = require("../db/task-relationships.js") as typeof import("../db/task-relationships.js");
      const rel = addTaskRelationship({
        source_task_id: resolveId(source_task_id),
        target_task_id: resolveId(target_task_id),
        relationship_type,
        created_by,
      });
      return { content: [{ type: "text" as const, text: `Relationship created: ${rel.source_task_id.slice(0,8)} --[${rel.relationship_type}]--> ${rel.target_task_id.slice(0,8)}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("remove_task_relationship")) {
server.tool(
  "remove_task_relationship",
  "Remove a semantic relationship between tasks by ID or by source+target+type.",
  {
    id: z.string().optional().describe("Relationship ID to remove"),
    source_task_id: z.string().optional().describe("Source task ID (use with target_task_id + type)"),
    target_task_id: z.string().optional().describe("Target task ID"),
    relationship_type: z.enum(["related_to", "conflicts_with", "similar_to", "duplicates", "supersedes", "modifies_same_file"]).optional(),
  },
  async ({ id, source_task_id, target_task_id, relationship_type }) => {
    try {
      const { removeTaskRelationship, removeTaskRelationshipByPair } = require("../db/task-relationships.js") as typeof import("../db/task-relationships.js");
      let removed = false;
      if (id) {
        removed = removeTaskRelationship(id);
      } else if (source_task_id && target_task_id && relationship_type) {
        removed = removeTaskRelationshipByPair(resolveId(source_task_id), resolveId(target_task_id), relationship_type);
      } else {
        return { content: [{ type: "text" as const, text: "Provide either 'id' or 'source_task_id + target_task_id + relationship_type'" }], isError: true };
      }
      return { content: [{ type: "text" as const, text: removed ? "Relationship removed." : "Relationship not found." }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("get_task_relationships")) {
server.tool(
  "get_task_relationships",
  "Get all semantic relationships for a task.",
  {
    task_id: z.string().describe("Task ID"),
    relationship_type: z.enum(["related_to", "conflicts_with", "similar_to", "duplicates", "supersedes", "modifies_same_file"]).optional(),
  },
  async ({ task_id, relationship_type }) => {
    try {
      const { getTaskRelationships } = require("../db/task-relationships.js") as typeof import("../db/task-relationships.js");
      const rels = getTaskRelationships(resolveId(task_id), relationship_type);
      if (rels.length === 0) return { content: [{ type: "text" as const, text: "No relationships found." }] };
      const lines = rels.map(r => `${r.source_task_id.slice(0,8)} --[${r.relationship_type}]--> ${r.target_task_id.slice(0,8)}${r.metadata && Object.keys(r.metadata).length > 0 ? ` (${JSON.stringify(r.metadata)})` : ""}`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("detect_file_relationships")) {
server.tool(
  "detect_file_relationships",
  "Auto-detect tasks that modify the same files and create modifies_same_file relationships.",
  {
    task_id: z.string().describe("Task ID to detect file relationships for"),
  },
  async ({ task_id }) => {
    try {
      const { autoDetectFileRelationships } = require("../db/task-relationships.js") as typeof import("../db/task-relationships.js");
      const created = autoDetectFileRelationships(resolveId(task_id));
      return { content: [{ type: "text" as const, text: created.length > 0 ? `Created ${created.length} file relationship(s).` : "No file overlaps detected." }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// === KNOWLEDGE GRAPH ===

if (shouldRegisterTool("sync_kg")) {
server.tool(
  "sync_kg",
  "Sync all existing relationships into the knowledge graph edges table. Idempotent.",
  {},
  async () => {
    try {
      const { syncKgEdges } = require("../db/kg.js") as typeof import("../db/kg.js");
      const result = syncKgEdges();
      return { content: [{ type: "text" as const, text: `Knowledge graph synced: ${result.synced} edge(s) processed.` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("get_related_entities")) {
server.tool(
  "get_related_entities",
  "Get entities related to a given entity in the knowledge graph.",
  {
    entity_id: z.string().describe("Entity ID (task, agent, project, file path)"),
    relation_type: z.string().optional().describe("Filter by relation type (depends_on, assigned_to, reports_to, references_file, in_project, in_plan, etc.)"),
    entity_type: z.string().optional().describe("Filter by entity type (task, agent, project, file, plan)"),
    direction: z.enum(["outgoing", "incoming", "both"]).optional().describe("Edge direction"),
    limit: z.number().optional().describe("Max results"),
  },
  async ({ entity_id, relation_type, entity_type, direction, limit }) => {
    try {
      const { getRelated } = require("../db/kg.js") as typeof import("../db/kg.js");
      const edges = getRelated(entity_id, { relation_type, entity_type, direction, limit });
      if (edges.length === 0) return { content: [{ type: "text" as const, text: "No related entities found." }] };
      const lines = edges.map(e => `${e.source_id.slice(0,12)}(${e.source_type}) --[${e.relation_type}]--> ${e.target_id.slice(0,12)}(${e.target_type})`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("find_path")) {
server.tool(
  "find_path",
  "Find paths between two entities in the knowledge graph.",
  {
    source_id: z.string().describe("Starting entity ID"),
    target_id: z.string().describe("Target entity ID"),
    max_depth: z.number().optional().describe("Maximum path depth (default: 5)"),
    relation_types: z.array(z.string()).optional().describe("Filter by relation types"),
  },
  async ({ source_id, target_id, max_depth, relation_types }) => {
    try {
      const { findPath } = require("../db/kg.js") as typeof import("../db/kg.js");
      const paths = findPath(source_id, target_id, { max_depth, relation_types });
      if (paths.length === 0) return { content: [{ type: "text" as const, text: "No path found." }] };
      const lines = paths.map((path, i) => {
        const steps = path.map(e => `${e.source_id.slice(0,8)} --[${e.relation_type}]--> ${e.target_id.slice(0,8)}`);
        return `Path ${i + 1} (${path.length} hops):\n  ${steps.join("\n  ")}`;
      });
      return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("get_impact_analysis")) {
server.tool(
  "get_impact_analysis",
  "Analyze what entities are affected if a given entity changes. Traverses the knowledge graph.",
  {
    entity_id: z.string().describe("Entity ID to analyze impact for"),
    max_depth: z.number().optional().describe("Maximum traversal depth (default: 3)"),
    relation_types: z.array(z.string()).optional().describe("Filter by relation types"),
  },
  async ({ entity_id, max_depth, relation_types }) => {
    try {
      const { getImpactAnalysis } = require("../db/kg.js") as typeof import("../db/kg.js");
      const impact = getImpactAnalysis(entity_id, { max_depth, relation_types });
      if (impact.length === 0) return { content: [{ type: "text" as const, text: "No downstream impact detected." }] };
      const byDepth = new Map<number, typeof impact>();
      for (const i of impact) {
        if (!byDepth.has(i.depth)) byDepth.set(i.depth, []);
        byDepth.get(i.depth)!.push(i);
      }
      const lines = [`Impact analysis: ${impact.length} affected entities`];
      for (const [depth, entities] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
        lines.push(`\nDepth ${depth}:`);
        for (const e of entities) {
          lines.push(`  ${e.entity_id.slice(0,12)} (${e.entity_type}) via ${e.relation}`);
        }
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("get_critical_path")) {
server.tool(
  "get_critical_path",
  "Find tasks that block the most downstream work (critical path analysis).",
  {
    project_id: z.string().optional().describe("Filter by project"),
    limit: z.number().optional().describe("Max results (default: 20)"),
  },
  async ({ project_id, limit }) => {
    try {
      const { getCriticalPath } = require("../db/kg.js") as typeof import("../db/kg.js");
      const result = getCriticalPath({ project_id: project_id ? resolveId(project_id, "projects") : undefined, limit });
      if (result.length === 0) return { content: [{ type: "text" as const, text: "No critical path data. Run sync_kg first to populate the knowledge graph." }] };
      const lines = result.map((r, i) => `${i + 1}. ${r.task_id.slice(0,8)} blocks ${r.blocking_count} task(s), max depth ${r.depth}`);
      return { content: [{ type: "text" as const, text: `Critical path:\n${lines.join("\n")}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// === PER-PROJECT ORG CHART ===

if (shouldRegisterTool("set_project_agent_role")) {
server.tool(
  "set_project_agent_role",
  "Assign an agent a role on a specific project (client, lead, developer, qa, reviewer, etc.). Per-project roles extend the global org chart.",
  {
    project_id: z.string().describe("Project ID"),
    agent_name: z.string().describe("Agent name"),
    role: z.string().describe("Role on this project (e.g. 'lead', 'developer', 'qa')"),
    is_lead: z.coerce.boolean().optional().describe("Whether this agent is the project lead for this role"),
  },
  async ({ project_id, agent_name, role, is_lead }) => {
    try {
      const { setProjectAgentRole } = require("../db/project-agent-roles.js") as any;
      const agent = getAgentByName(agent_name);
      if (!agent) return { content: [{ type: "text" as const, text: `Agent not found: ${agent_name}` }], isError: true };
      const pid = resolveId(project_id, "projects");
      const result = setProjectAgentRole(pid, agent.id, role, is_lead ?? false);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

if (shouldRegisterTool("get_project_org_chart")) {
server.tool(
  "get_project_org_chart",
  "Get org chart scoped to a project — global hierarchy with per-project role overrides merged in.",
  {
    project_id: z.string().describe("Project ID"),
    format: z.enum(["text", "json"]).optional().describe("Output format (default: text)"),
    filter_to_project: z.coerce.boolean().optional().describe("Only show agents with a role on this project"),
  },
  async ({ project_id, format, filter_to_project }) => {
    try {
      const { getProjectOrgChart } = require("../db/project-agent-roles.js") as any;
      const pid = resolveId(project_id, "projects");
      const tree = getProjectOrgChart(pid, { filter_to_project });

      if (format === "json") {
        return { content: [{ type: "text" as const, text: JSON.stringify(tree, null, 2) }] };
      }

      const now = Date.now();
      const ACTIVE_MS = 30 * 60 * 1000;
      function render(nodes: any[], indent = 0): string {
        return nodes.map(n => {
          const prefix = "  ".repeat(indent);
          const title = n.agent.title ? ` — ${n.agent.title}` : "";
          const globalRole = n.agent.role ? ` [${n.agent.role}]` : "";
          const projectRoles = n.project_roles.length > 0 ? ` <${n.project_roles.join(", ")}>` : "";
          const lead = n.is_project_lead ? " ★" : "";
          const lastSeen = new Date(n.agent.last_seen_at).getTime();
          const active = now - lastSeen < ACTIVE_MS ? " ●" : " ○";
          const line = `${prefix}${active} ${n.agent.name}${title}${globalRole}${projectRoles}${lead}`;
          const children = n.reports.length > 0 ? "\n" + render(n.reports, indent + 1) : "";
          return line + children;
        }).join("\n");
      }
      const text = tree.length > 0 ? render(tree) : "No agents in this project's org chart.";
      return { content: [{ type: "text" as const, text }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

if (shouldRegisterTool("list_project_agent_roles")) {
server.tool(
  "list_project_agent_roles",
  "List all agent role assignments for a project.",
  {
    project_id: z.string().describe("Project ID"),
  },
  async ({ project_id }) => {
    try {
      const { listProjectAgentRoles } = require("../db/project-agent-roles.js") as any;
      const pid = resolveId(project_id, "projects");
      const roles = listProjectAgentRoles(pid);
      return { content: [{ type: "text" as const, text: JSON.stringify(roles, null, 2) }] };
    } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
  },
);
}

// === AGENT CAPABILITIES ===

if (shouldRegisterTool("get_capable_agents")) {
server.tool(
  "get_capable_agents",
  "Find agents that match given capabilities, sorted by match score.",
  {
    capabilities: z.array(z.string()).describe("Required capabilities to match against"),
    min_score: z.number().optional().describe("Minimum match score 0.0-1.0 (default: 0.1)"),
    limit: z.number().optional().describe("Max results"),
  },
  async ({ capabilities, min_score, limit }) => {
    try {
      const { getCapableAgents } = require("../db/agents.js") as typeof import("../db/agents.js");
      const results = getCapableAgents(capabilities, { min_score, limit });
      if (results.length === 0) return { content: [{ type: "text" as const, text: "No agents match the given capabilities." }] };
      const lines = results.map(r => `${r.agent.name} (${r.agent.id}) score:${(r.score * 100).toFixed(0)}% caps:[${r.agent.capabilities.join(",")}]`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// === PATROL & REVIEW ===

if (shouldRegisterTool("patrol_tasks")) {
server.tool(
  "patrol_tasks",
  "Scan for task issues: stuck tasks, low-confidence completions, orphaned tasks, zombie-blocked tasks, and pending reviews.",
  {
    stuck_minutes: z.number().optional().describe("Minutes threshold for stuck detection (default: 60)"),
    confidence_threshold: z.number().optional().describe("Confidence threshold for low-confidence detection (default: 0.5)"),
    project_id: z.string().optional().describe("Filter by project"),
  },
  async ({ stuck_minutes, confidence_threshold, project_id }) => {
    try {
      const { patrolTasks } = require("../db/patrol.js") as typeof import("../db/patrol.js");
      const result = patrolTasks({
        stuck_minutes,
        confidence_threshold,
        project_id: project_id ? resolveId(project_id, "projects") : undefined,
      });
      if (result.total_issues === 0) return { content: [{ type: "text" as const, text: "All clear — no issues detected." }] };
      const lines = [`Found ${result.total_issues} issue(s):\n`];
      for (const issue of result.issues) {
        lines.push(`[${issue.severity.toUpperCase()}] ${issue.type}: ${issue.task_title.slice(0,60)} (${issue.task_id.slice(0,8)})`);
        lines.push(`  ${issue.detail}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("get_review_queue")) {
server.tool(
  "get_review_queue",
  "Get tasks that need review: requires_approval but unapproved, or low confidence completions.",
  {
    project_id: z.string().optional().describe("Filter by project"),
    limit: z.number().optional().describe("Max results (default: all)"),
  },
  async ({ project_id, limit }) => {
    try {
      const { getReviewQueue } = require("../db/patrol.js") as typeof import("../db/patrol.js");
      const tasks = getReviewQueue({
        project_id: project_id ? resolveId(project_id, "projects") : undefined,
        limit,
      });
      if (tasks.length === 0) return { content: [{ type: "text" as const, text: "Review queue is empty." }] };
      const lines = tasks.map(t => {
        const conf = t.confidence != null ? ` confidence:${t.confidence}` : "";
        const approval = t.requires_approval && !t.approved_by ? " [needs approval]" : "";
        return `${(t.short_id || t.id.slice(0,8))} ${t.title.slice(0,60)}${conf}${approval}`;
      });
      return { content: [{ type: "text" as const, text: `Review queue (${tasks.length}):\n${lines.join("\n")}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("score_task")) {
server.tool(
  "score_task",
  "Score a completed task's quality (0.0-1.0). Stores in task metadata for agent performance tracking.",
  {
    task_id: z.string().describe("Task ID to score"),
    score: z.number().min(0).max(1).describe("Quality score 0.0-1.0"),
    reviewer_id: z.string().optional().describe("Agent ID of reviewer"),
  },
  async ({ task_id, score, reviewer_id }) => {
    try {
      const { scoreTask } = require("../db/agent-metrics.js") as typeof import("../db/agent-metrics.js");
      scoreTask(resolveId(task_id), score, reviewer_id);
      return { content: [{ type: "text" as const, text: `Task ${task_id.slice(0,8)} scored: ${score}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// === AGENT METRICS & LEADERBOARD ===

if (shouldRegisterTool("get_agent_metrics")) {
server.tool(
  "get_agent_metrics",
  "Get performance metrics for an agent: completion rate, speed, confidence, review scores.",
  {
    agent_id: z.string().describe("Agent ID or name"),
    project_id: z.string().optional().describe("Filter by project"),
  },
  async ({ agent_id, project_id }) => {
    try {
      const { getAgentMetrics } = require("../db/agent-metrics.js") as typeof import("../db/agent-metrics.js");
      const metrics = getAgentMetrics(agent_id, {
        project_id: project_id ? resolveId(project_id, "projects") : undefined,
      });
      if (!metrics) return { content: [{ type: "text" as const, text: `Agent not found: ${agent_id}` }], isError: true };
      const lines = [
        `Agent: ${metrics.agent_name} (${metrics.agent_id})`,
        `Completed: ${metrics.tasks_completed} | Failed: ${metrics.tasks_failed} | In Progress: ${metrics.tasks_in_progress}`,
        `Completion Rate: ${(metrics.completion_rate * 100).toFixed(1)}%`,
        metrics.avg_completion_minutes != null ? `Avg Completion Time: ${metrics.avg_completion_minutes} min` : null,
        metrics.avg_confidence != null ? `Avg Confidence: ${(metrics.avg_confidence * 100).toFixed(1)}%` : null,
        metrics.review_score_avg != null ? `Avg Review Score: ${(metrics.review_score_avg * 100).toFixed(1)}%` : null,
        `Composite Score: ${(metrics.composite_score * 100).toFixed(1)}%`,
      ].filter(Boolean);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

if (shouldRegisterTool("get_leaderboard")) {
server.tool(
  "get_leaderboard",
  "Get agent leaderboard ranked by composite performance score.",
  {
    project_id: z.string().optional().describe("Filter by project"),
    limit: z.number().optional().describe("Max entries (default: 20)"),
  },
  async ({ project_id, limit }) => {
    try {
      const { getLeaderboard } = require("../db/agent-metrics.js") as typeof import("../db/agent-metrics.js");
      const entries = getLeaderboard({
        project_id: project_id ? resolveId(project_id, "projects") : undefined,
        limit,
      });
      if (entries.length === 0) return { content: [{ type: "text" as const, text: "No agents with task activity found." }] };
      const lines = entries.map(e =>
        `#${e.rank} ${e.agent_name.padEnd(15)} score:${(e.composite_score * 100).toFixed(0).padStart(3)}% done:${String(e.tasks_completed).padStart(3)} rate:${(e.completion_rate * 100).toFixed(0)}%`
      );
      return { content: [{ type: "text" as const, text: `Leaderboard:\n${lines.join("\n")}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

// === EXTRACT TODOS FROM CODE COMMENTS ===

if (shouldRegisterTool("extract_todos")) {
server.tool(
  "extract_todos",
  "Scan source files for TODO/FIXME/HACK/BUG/XXX/NOTE comments and create tasks from them. Deduplicates on re-runs.",
  {
    path: z.string().describe("Directory or file path to scan"),
    project_id: z.string().optional().describe("Project to assign tasks to"),
    task_list_id: z.string().optional().describe("Task list to add tasks to"),
    patterns: z.array(z.enum(["TODO", "FIXME", "HACK", "XXX", "BUG", "NOTE"])).optional().describe("Tags to search for (default: all)"),
    tags: z.array(z.string()).optional().describe("Extra tags to add to created tasks"),
    assigned_to: z.string().optional().describe("Agent to assign tasks to"),
    agent_id: z.string().optional().describe("Agent performing the extraction"),
    dry_run: z.boolean().optional().describe("If true, return found comments without creating tasks"),
    extensions: z.array(z.string()).optional().describe("File extensions to scan (e.g. ['ts', 'py'])"),
  },
  async (params) => {
    try {
      const { extractTodos } = require("../lib/extract.js") as typeof import("../lib/extract.js");
      const resolved: Record<string, unknown> = { ...params };
      if (resolved["project_id"]) resolved["project_id"] = resolveId(resolved["project_id"] as string, "projects");
      if (resolved["task_list_id"]) resolved["task_list_id"] = resolveId(resolved["task_list_id"] as string, "task_lists");

      const result = extractTodos(resolved as unknown as Parameters<typeof extractTodos>[0]);

      if (params.dry_run) {
        const lines = result.comments.map(c => `[${c.tag}] ${c.message} — ${c.file}:${c.line}`);
        return { content: [{ type: "text" as const, text: `Found ${result.comments.length} comment(s):\n${lines.join("\n")}` }] };
      }

      const summary = [
        `Created ${result.tasks.length} task(s)`,
        result.skipped > 0 ? `Skipped ${result.skipped} duplicate(s)` : null,
        `Total comments found: ${result.comments.length}`,
      ].filter(Boolean).join("\n");

      const taskLines = result.tasks.map(t => formatTask(t));
      return { content: [{ type: "text" as const, text: `${summary}\n\n${taskLines.join("\n")}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
    }
  },
);
}

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
