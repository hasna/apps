import { EventsClient } from "@hasna/events";
import type { EventSeverity } from "@hasna/events";
import { getDatabase } from "../db/database.js";
import { getProject } from "../db/projects.js";
import { getTaskList, getTaskListBySlug } from "../db/task-lists.js";
import type { Project } from "../types/index.js";
import type { Task } from "../types/index.js";
import {
  classifyProjectKind,
  inferRootProjectId,
  isWorktreePath,
  projectKindFromMetadata,
  routeEnabledForTask,
  routingAutomationMetadata,
  TODOS_TASK_ROUTE_STATE_SCHEMA_VERSION,
  workflowPointersFromMetadata,
} from "./task-route-contract.js";
import { shouldEmitSharedTaskEvents } from "./event-emission-safety.js";

const SOURCE = "todos";

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

function taskEventMetadata(task: Task): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    package: "@hasna/todos",
    todos_event_schema_version: 1,
    route_state_schema_version: TODOS_TASK_ROUTE_STATE_SCHEMA_VERSION,
    task_id: task.id,
    task_short_id: task.short_id,
    project_id: task.project_id,
    task_list_id: task.task_list_id,
    working_dir: task.working_dir,
  };

  const pointers = workflowPointersFromMetadata(task.metadata);
  for (const [key, value] of Object.entries(pointers)) {
    if (value) metadata[key] = value;
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

    const projectKind = projectKindFromMetadata(task.metadata, taskList?.metadata);
    if (projectKind) {
      metadata.project_kind = classifyProjectKind(projectPath ?? "", { project_kind: projectKind });
    }

    const routeEnabled = routeEnabledForTask(task, taskList);
    if (routeEnabled !== undefined) {
      metadata.route_enabled = routeEnabled;
    }
    const automation = routingAutomationMetadata(task, taskList);
    if (automation) {
      metadata.automation = automation;
      metadata.route_blocked_by_no_auto = automation.no_auto === true;
      metadata.route_blocked_by_manual = automation.manual === true || automation.manual_required === true;
      metadata.route_blocked_by_approval = (automation.requires_approval === true || automation.approval_required === true) && !task.approved_by;
    }
  } catch {
    // Event enrichment must never block task lifecycle operations.
  }

  return metadata;
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
  databasePath?: string;
}): Promise<void> {
  if (!shouldEmitSharedTaskEvents(input.databasePath)) return;
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
