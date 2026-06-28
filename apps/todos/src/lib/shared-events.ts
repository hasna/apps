import { EventsClient } from "@hasna/events";
import type { EventSeverity } from "@hasna/events";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { getDatabase } from "../db/database.js";
import { getProject } from "../db/projects.js";
import { getTaskList, getTaskListBySlug } from "../db/task-lists.js";
import type { Project } from "../types/index.js";
import type { Task } from "../types/index.js";

const SOURCE = "todos";
const ALLOW_GLOBAL_EVENTS_FROM_TEMP_DB = "HASNA_TODOS_ALLOW_GLOBAL_EVENTS_FROM_TEMP_DB";

export type TodosSharedEventType =
  | "task.created"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "task.updated"
  | "task.assigned"
  | "task.status_changed"
  | "task.unblocked";

export function taskEventData(task: Task, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: task.id,
    task_id: task.id,
    short_id: task.short_id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    project_id: task.project_id,
    parent_id: task.parent_id,
    plan_id: task.plan_id,
    task_list_id: task.task_list_id,
    agent_id: task.agent_id,
    assigned_to: task.assigned_to,
    session_id: task.session_id,
    working_dir: task.working_dir,
    tags: task.tags,
    metadata: task.metadata,
    version: task.version,
    created_at: task.created_at,
    updated_at: task.updated_at,
    started_at: task.started_at,
    completed_at: task.completed_at,
    due_at: task.due_at,
    requires_approval: task.requires_approval,
    approved_by: task.approved_by,
    approved_at: task.approved_at,
    ...extra,
  };
}

function booleanField(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return undefined;
}

function objectField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function explicitTaskDbPath(): string | undefined {
  return process.env["HASNA_TODOS_DB_PATH"] || process.env["TODOS_DB_PATH"];
}

function isTruthyEnv(value: string | undefined): boolean {
  return value ? ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()) : false;
}

function isInMemoryDbPath(path: string): boolean {
  return path === ":memory:" || path.startsWith("file::memory:");
}

function isUnderTmpDir(path: string): boolean {
  const normalized = resolve(path);
  const tmp = resolve(tmpdir());
  return normalized === tmp || normalized.startsWith(`${tmp}${sep}`);
}

export function shouldEmitSharedTaskEvents(): boolean {
  const explicitDb = explicitTaskDbPath();
  if (!explicitDb) return true;
  if (process.env["HASNA_EVENTS_DIR"] || process.env["HASNA_EVENTS_HOME"]) return true;
  if (isTruthyEnv(process.env[ALLOW_GLOBAL_EVENTS_FROM_TEMP_DB])) return true;
  return !(isInMemoryDbPath(explicitDb) || isUnderTmpDir(explicitDb));
}

function firstBoolean(records: Record<string, unknown>[], keys: string[]): boolean | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = booleanField(record[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function routingAutomationMetadata(task: Task): Record<string, boolean> | undefined {
  const automation = objectField(task.metadata.automation);
  const records = [task.metadata];
  if (automation) records.push(automation);

  const result: Record<string, boolean> = {};
  const aliases: Array<[string, string[]]> = [
    ["allowed", ["allowed", "automation_allowed", "automationAllowed"]],
    ["no_auto", ["no_auto", "noAuto"]],
    ["manual", ["manual"]],
    ["manual_required", ["manual_required", "manualRequired"]],
    ["requires_approval", ["requires_approval", "requiresApproval"]],
    ["approval_required", ["approval_required", "approvalRequired"]],
  ];

  for (const [canonical, keys] of aliases) {
    const value = firstBoolean(records, keys);
    if (value !== undefined) result[canonical] = value;
  }
  if (task.requires_approval) result.requires_approval = true;

  return Object.keys(result).length > 0 ? result : undefined;
}

function taskEventMetadata(task: Task): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    package: "@hasna/todos",
    todos_event_schema_version: 1,
    task_id: task.id,
    task_short_id: task.short_id,
    project_id: task.project_id,
    task_list_id: task.task_list_id,
    working_dir: task.working_dir,
  };

  const routeEnabled = booleanField(task.metadata.route_enabled);
  if (routeEnabled !== undefined) {
    metadata.route_enabled = routeEnabled;
  }
  const automation = routingAutomationMetadata(task);
  if (automation) {
    metadata.automation = automation;
  }

  try {
    const project = task.project_id ? getProject(task.project_id) : null;
    const projectPath = project ? readMachineLocalPath(project) ?? project.path : task.working_dir;
    if (project) {
      metadata.project_id = project.id;
      metadata.project_name = project.name;
      metadata.project_path = projectPath;
      metadata.project_canonical_path = project.path;
      metadata.project_default_task_list_slug = project.task_list_id;
      metadata.root_project_id = inferRootProjectId(project);
    } else if (projectPath) {
      metadata.project_path = projectPath;
      metadata.project_canonical_path = projectPath;
    }
    if (projectPath) {
      metadata.project_kind = classifyProjectKind(projectPath);
      metadata.project_is_worktree = isWorktreePath(projectPath);
      metadata.working_dir = task.working_dir ?? projectPath;
    }

    const taskList = task.task_list_id
      ? getTaskList(task.task_list_id) ?? (project ? getTaskListBySlug(task.task_list_id, project.id) : null)
      : project?.task_list_id
        ? getTaskListBySlug(project.task_list_id, project.id)
        : null;
    if (taskList) {
      metadata.task_list_id = taskList.id;
      metadata.task_list_slug = taskList.slug;
      metadata.task_list_name = taskList.name;
      metadata.task_list_project_id = taskList.project_id;
      metadata.task_list_is_project_default = Boolean(project?.task_list_id && taskList.slug === project.task_list_id);
    }
  } catch {
    // Event enrichment must never block task lifecycle operations.
  }

  return metadata;
}

function classifyProjectKind(path: string): string {
  return path.includes("/hasna/opensource/") ? "open-source" : "unknown";
}

function isWorktreePath(path: string): boolean {
  return path.includes("/.codewith/worktrees/") || path.includes("/.worktrees/");
}

function inferRootProjectId(project: Project): string | null {
  return isWorktreePath(project.path) ? null : project.id;
}

function readMachineLocalPath(project: Project): string | null {
  const machineId = process.env["TODOS_MACHINE_ID"];
  if (!machineId) return null;
  try {
    const row = getDatabase()
      .query("SELECT path FROM project_machine_paths WHERE project_id = ? AND machine_id = ?")
      .get(project.id, machineId) as { path: string } | null;
    return row?.path ?? null;
  } catch {
    return null;
  }
}

export async function emitSharedTaskEvent(input: {
  type: TodosSharedEventType;
  task: Task;
  data?: Record<string, unknown>;
  message?: string;
  severity?: EventSeverity;
  dedupeKey?: string;
}): Promise<void> {
  if (!shouldEmitSharedTaskEvents()) return;

  const data = taskEventData(input.task, input.data);
  await new EventsClient().emit(
    {
      source: SOURCE,
      type: input.type,
      subject: input.task.id,
      severity: input.severity ?? "info",
      message: input.message ?? `${input.type}: ${input.task.title}`,
      data,
      dedupeKey: input.dedupeKey ?? `${input.type}:${input.task.id}:${input.task.version}`,
      metadata: taskEventMetadata(input.task),
    },
    { deliver: true, dedupe: true },
  );
}

export function emitSharedTaskEventQuiet(input: Parameters<typeof emitSharedTaskEvent>[0]): void {
  emitSharedTaskEvent(input).catch(() => undefined);
}
