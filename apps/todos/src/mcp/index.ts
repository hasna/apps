#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCloudSyncTools } from "./tools/cloud.js";
import { getAgent, getAgentByName } from "../db/agents.js";
import { getDatabase, resolvePartialId } from "../db/database.js";
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
  DispatchNotFoundError,
} from "../types/index.js";
import type { Task } from "../types/index.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { registerDispatchTools } from "./tools/dispatch.js";
import { registerTaskCrudTools } from "./tools/task-crud.js";
import { registerTaskProjectTools } from "./tools/task-project-tools.js";
import { registerTaskWorkflowTools } from "./tools/task-workflow-tools.js";
import { registerTaskAutoTools } from "./tools/task-auto-tools.js";
import { registerTaskAdvTools } from "./tools/task-adv-tools.js";
import { registerTaskMetaTools } from "./tools/task-meta-tools.js";
import { registerTaskResources } from "./tools/task-resources.js";
import { registerTaskRelTools } from "./tools/task-rel-tools.js";
import { registerCodeTools } from "./tools/code-tools.js";

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
  "create_template", "list_templates", "create_task_from_template", "delete_template", "update_template",
  "init_templates", "preview_template", "export_template", "import_template", "template_history",
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
  if (error instanceof DispatchNotFoundError) {
    return JSON.stringify({ code: DispatchNotFoundError.code, message: error.message, suggestion: DispatchNotFoundError.suggestion });
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
      const match = msg.match(/UNIQUE constraint failed: (\w+)\.(\w+)/);
      const table = match?.[1] ?? "unknown";
      const column = match?.[2] ?? "unknown";
      return JSON.stringify({ code: "DUPLICATE_ENTRY", message: `Duplicate entry in ${table}.${column}. The record already exists.`, suggestion: `Use the list or get endpoint for ${table} to find the existing record, or use a different value for ${column}.` });
    }
    if (msg.includes("FOREIGN KEY constraint failed")) {
      return JSON.stringify({ code: "REFERENCE_ERROR", message: "Referenced record does not exist. Check that the ID is correct.", suggestion: "Verify the referenced ID exists before creating this record." });
    }
    // Sanitize: never expose raw database error messages (may contain schema info)
    console.error("[mcp] Unhandled error:", msg);
    return JSON.stringify({ code: "UNKNOWN_ERROR", message: "An unexpected error occurred. Check server logs for details." });
  }
  return JSON.stringify({ code: "UNKNOWN_ERROR", message: "An unexpected error occurred." });
}

function resolveId(partialId: string, table = "tasks"): string {
  const db = getDatabase();
  const id = resolvePartialId(db, table, partialId);
  if (!id) throw new Error(`Could not resolve ID: ${partialId}`);
  return id;
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
  if (task.due_at) parts.push(`Due: ${task.due_at.slice(0, 10)}`);
  if (task.tags.length > 0) parts.push(`Tags: ${task.tags.join(", ")}`);
  if (task.recurrence_rule) parts.push(`Recurrence: ${task.recurrence_rule}`);
  if (task.recurrence_parent_id) parts.push(`Recurrence parent: ${task.recurrence_parent_id}`);
  parts.push(`Version: ${task.version}`);
  parts.push(`Created: ${task.created_at}`);
  if (task.completed_at) parts.push(`Completed: ${task.completed_at}`);
  return parts.join("\n");
}

// === REGISTER ALL TOOLS ===

const toolContext = {
  shouldRegisterTool,
  resolveId,
  formatError,
  formatTask,
  formatTaskDetail,
  getAgentFocus,
};

registerTaskCrudTools(server, toolContext);
registerTaskProjectTools(server, toolContext);
registerTaskWorkflowTools(server, toolContext);
registerTaskAutoTools(server, toolContext);
registerTaskAdvTools(server, toolContext);
registerTaskMetaTools(server, toolContext);
registerTaskResources(server, toolContext);
registerTaskRelTools(server, toolContext);
registerCodeTools(server, toolContext);

// === DISPATCH ===

registerDispatchTools(server, { shouldRegisterTool, resolveId, formatError });

// === CLOUD ===

registerCloudSyncTools(server, { shouldRegisterTool, formatError });

// === START SERVER ===

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
