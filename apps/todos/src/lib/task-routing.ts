import type { Database } from "bun:sqlite";
import { getDatabase, isLockExpired, now } from "../db/database.js";
import { getProject } from "../db/projects.js";
import { getTask, updateTask } from "../db/task-crud.js";
import { getBlockingDeps } from "../db/task-lifecycle.js";
import { getTaskList, getTaskListBySlug } from "../db/task-lists.js";
import type { Project, Task, TaskList } from "../types/index.js";
import {
  compactWorkflowPointers,
  routeEnabledForTask,
  routingAutomationMetadata,
  TASK_WORKFLOW_POINTER_SCHEMA_VERSION,
  TODOS_TASK_ROUTE_STATE_SCHEMA_VERSION,
  workflowPointersFromMetadata,
  type TaskRoutingAutomationMetadata,
  type TaskWorkflowPointers,
} from "./task-route-contract.js";

export interface TaskRouteGates {
  route_enabled: boolean;
  tag_opt_in: boolean;
  no_auto: boolean;
  manual: boolean;
  manual_required: boolean;
  requires_approval: boolean;
  approval_required: boolean;
  approved: boolean;
  locked: boolean;
  blocked: boolean;
  terminal: boolean;
}

export interface TaskRouteContext {
  project_id: string | null;
  project_path: string | null;
  working_dir: string | null;
  project_kind: string | null;
  task_list_id: string | null;
  task_list_slug: string | null;
  task_list_name: string | null;
  concurrency_key: string;
}

export interface TaskRouteState {
  schema_version: typeof TODOS_TASK_ROUTE_STATE_SCHEMA_VERSION;
  task_id: string;
  task_short_id: string | null;
  status: Task["status"];
  eligible: boolean;
  reasons: string[];
  blockers: Array<{ id: string; short_id: string | null; title: string; status: Task["status"] }>;
  gates: TaskRouteGates;
  automation: TaskRoutingAutomationMetadata | null;
  route: TaskRouteContext;
  pointers: TaskWorkflowPointers;
}

export interface SetTaskWorkflowPointersInput {
  current_workflow_invocation_id?: string | null;
  current_run_id?: string | null;
  latest_manifest_path?: string | null;
  latest_evaluation_path?: string | null;
  workflow_state?: string | null;
  actor?: string;
}

function classifyProjectKind(path: string | null): string | null {
  if (!path) return null;
  return path.includes("/hasna/opensource/") ? "open-source" : "unknown";
}

function machineLocalPath(project: Project, db: Database): string | null {
  const machineId = process.env["TODOS_MACHINE_ID"];
  if (!machineId) return null;
  try {
    const row = db
      .query("SELECT path FROM project_machine_paths WHERE project_id = ? AND machine_id = ?")
      .get(project.id, machineId) as { path: string } | null;
    return row?.path ?? null;
  } catch {
    return null;
  }
}

function resolveProject(task: Task, db: Database): { project: Project | null; projectPath: string | null } {
  const project = task.project_id ? getProject(task.project_id, db) : null;
  const projectPath = project ? machineLocalPath(project, db) ?? project.path : task.working_dir;
  return { project, projectPath: projectPath ?? null };
}

function resolveTaskList(task: Task, project: Project | null, db: Database): TaskList | null {
  if (task.task_list_id) {
    return getTaskList(task.task_list_id, db) ?? (project ? getTaskListBySlug(task.task_list_id, project.id, db) : null);
  }
  if (project?.task_list_id) {
    return getTaskListBySlug(project.task_list_id, project.id, db);
  }
  return null;
}

function isTerminal(status: Task["status"]): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}

function routeConcurrencyKey(task: Task, project: Project | null, taskList: TaskList | null, projectPath: string | null): string {
  if (project?.id) return `project:${project.id}`;
  if (taskList?.id) return `task-list:${taskList.id}`;
  if (projectPath) return `path:${projectPath}`;
  return `task:${task.id}`;
}

export function getTaskRouteState(taskOrId: Task | string, db?: Database): TaskRouteState {
  const d = db || getDatabase();
  const task = typeof taskOrId === "string" ? getTask(taskOrId, d) : taskOrId;
  if (!task) throw new Error(`Task not found: ${taskOrId}`);

  const { project, projectPath } = resolveProject(task, d);
  const taskList = resolveTaskList(task, project, d);
  const automation = routingAutomationMetadata(task, taskList) ?? {};
  const routeEnabled = routeEnabledForTask(task, taskList) === true;
  const tagOptIn = task.tags.includes("auto:route") || task.tags.includes("route:enabled");
  const locked = Boolean(task.locked_by && !isLockExpired(task.locked_at));
  const blockers = getBlockingDeps(task.id, d);
  const blocked = blockers.length > 0;
  const terminal = isTerminal(task.status);
  const requiresApproval = automation.requires_approval === true || task.requires_approval === true;
  const approvalRequired = automation.approval_required === true;
  const approved = Boolean(task.approved_by);

  const gates: TaskRouteGates = {
    route_enabled: routeEnabled,
    tag_opt_in: tagOptIn,
    no_auto: automation.no_auto === true,
    manual: automation.manual === true,
    manual_required: automation.manual_required === true,
    requires_approval: requiresApproval,
    approval_required: approvalRequired,
    approved,
    locked,
    blocked,
    terminal,
  };

  const reasons: string[] = [];
  if (task.status !== "pending") reasons.push("task_not_pending");
  if (terminal) reasons.push("task_terminal");
  if (!routeEnabled) reasons.push("route_not_enabled");
  if (locked) reasons.push("task_locked");
  if (blocked) reasons.push("task_blocked");
  if (gates.no_auto) reasons.push("no_auto");
  if (gates.manual) reasons.push("manual");
  if (gates.manual_required) reasons.push("manual_required");
  if (requiresApproval && !approved) reasons.push("requires_approval");
  if (approvalRequired && !approved) reasons.push("approval_required");
  if (automation.allowed === false) reasons.push("automation_disallowed");

  return {
    schema_version: TODOS_TASK_ROUTE_STATE_SCHEMA_VERSION,
    task_id: task.id,
    task_short_id: task.short_id,
    status: task.status,
    eligible: reasons.length === 0,
    reasons,
    blockers: blockers.map((blocker) => ({
      id: blocker.id,
      short_id: blocker.short_id,
      title: blocker.title,
      status: blocker.status,
    })),
    gates,
    automation: Object.keys(automation).length > 0 ? automation : null,
    route: {
      project_id: project?.id ?? task.project_id,
      project_path: projectPath,
      working_dir: task.working_dir ?? projectPath,
      project_kind: classifyProjectKind(projectPath),
      task_list_id: taskList?.id ?? task.task_list_id,
      task_list_slug: taskList?.slug ?? null,
      task_list_name: taskList?.name ?? null,
      concurrency_key: routeConcurrencyKey(task, project, taskList, projectPath),
    },
    pointers: workflowPointersFromMetadata(task.metadata),
  };
}

export function setTaskWorkflowPointers(
  taskId: string,
  input: SetTaskWorkflowPointersInput,
  db?: Database,
): Task {
  const d = db || getDatabase();
  const task = getTask(taskId, d);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const previous = workflowPointersFromMetadata(task.metadata);
  const next = compactWorkflowPointers({
    current_workflow_invocation_id: pointerPatch(previous.current_workflow_invocation_id, input, "current_workflow_invocation_id"),
    current_run_id: pointerPatch(previous.current_run_id, input, "current_run_id"),
    latest_manifest_path: pointerPatch(previous.latest_manifest_path, input, "latest_manifest_path"),
    latest_evaluation_path: pointerPatch(previous.latest_evaluation_path, input, "latest_evaluation_path"),
    workflow_state: pointerPatch(previous.workflow_state, input, "workflow_state"),
  });

  const timestamp = now();
  const {
    current_workflow_invocation_id,
    current_run_id,
    latest_manifest_path,
    latest_evaluation_path,
    workflow_state,
    workflow_invocation,
    ...baseMetadata
  } = task.metadata;
  const metadata = {
    ...baseMetadata,
    ...next,
    workflow_invocation: {
      schema_version: TASK_WORKFLOW_POINTER_SCHEMA_VERSION,
      ...next,
      updated_at: timestamp,
      updated_by: input.actor ?? null,
    },
  };

  return updateTask(task.id, { version: task.version, metadata }, d);
}

function pointerPatch(
  previous: string | undefined,
  input: SetTaskWorkflowPointersInput,
  key: keyof TaskWorkflowPointers,
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(input, key)) return previous;
  const value = input[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}
