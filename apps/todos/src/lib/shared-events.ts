import { EventsClient } from "@hasna/events";
import type { EventSeverity } from "@hasna/events";
import { getDatabase } from "../db/database.js";
import { getProject } from "../db/projects.js";
import { getTaskList, getTaskListBySlug } from "../db/task-lists.js";
import type { Project } from "../types/index.js";
import type { Task } from "../types/index.js";

const SOURCE = "todos";

export type TodosSharedEventType =
  | "task.created"
  | "task.started"
  | "task.completed"
  | "task.failed"
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
    ...extra,
  };
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
      if (typeof task.metadata.route_enabled === "boolean") {
        metadata.route_enabled = task.metadata.route_enabled;
      }
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
