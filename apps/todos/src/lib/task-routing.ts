import type { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
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
  projectKindFromMetadata,
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
  /** True when a project root was required-checked and is missing/invalid on this machine. */
  missing_project_root: boolean;
  /** True when the task carries a workflow pointer for an in-flight (non-terminal) invocation. */
  workflow_pointer_active: boolean;
  /** True when the task carries a workflow pointer whose last invocation reached a terminal state. */
  workflow_pointer_terminal: boolean;
}

/**
 * One authoritative disposition a drain can act on without recomputing eligibility.
 * `eligible` admits routing now; `deduped_active`/`terminal_requeue_needed` are
 * eligible sub-states that tell a drain to dedupe against the live invocation or
 * requeue past a dead one; the remaining values are non-admitting reasons.
 * `throttled` is OpenLoops-owned runtime state and is never emitted by Todos; it is
 * part of the shared vocabulary so a consuming drain can classify uniformly.
 */
export type TaskRouteClass =
  | "eligible"
  | "deduped_active"
  | "terminal_requeue_needed"
  | "terminal"
  | "in_progress"
  | "blocked"
  | "locked"
  | "unroutable"
  | "missing_metadata"
  | "throttled";

export interface TaskRouteEvidence {
  /** Best-effort owner of active/in-flight work: assignee, else lock holder. */
  owner: string | null;
  assigned_to: string | null;
  locked_by: string | null;
  locked_at: string | null;
  updated_at: string;
  age_ms: number;
  /** True for an in_progress task whose last update is older than the stale threshold. */
  stale: boolean;
  stale_after_ms: number;
  current_run_id: string | null;
  current_workflow_invocation_id: string | null;
  workflow_state: string | null;
  /** Whether the project root was filesystem-verified for this evaluation. */
  project_root_verified: boolean;
  /** Existence of the resolved project root when verified; null when not checked. */
  project_root_exists: boolean | null;
}

export interface GetTaskRouteStateOptions {
  /**
   * When true, resolve and filesystem-check the project root and surface
   * `missing_project_root` before route admission (default false so pure
   * DB evaluations stay machine-independent).
   */
  verifyProjectRoot?: boolean;
  /** Age after which an in_progress task is flagged stale in evidence (default 3d). */
  staleInProgressAfterMs?: number;
}

const DEFAULT_STALE_IN_PROGRESS_MS = 3 * 24 * 60 * 60 * 1000;

const TERMINAL_WORKFLOW_STATES = new Set([
  "failed",
  "cancelled",
  "canceled",
  "completed",
  "complete",
  "done",
  "error",
  "errored",
  "timeout",
  "timed_out",
  "aborted",
  "superseded",
]);

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
  /** Single authoritative disposition; drains map this without recomputing eligibility. */
  route_class: TaskRouteClass;
  reasons: string[];
  blockers: Array<{ id: string; short_id: string | null; title: string; status: Task["status"] }>;
  gates: TaskRouteGates;
  automation: TaskRoutingAutomationMetadata | null;
  route: TaskRouteContext;
  pointers: TaskWorkflowPointers;
  evidence: TaskRouteEvidence;
}

export interface SetTaskWorkflowPointersInput {
  current_workflow_invocation_id?: string | null;
  current_run_id?: string | null;
  latest_manifest_path?: string | null;
  latest_evaluation_path?: string | null;
  workflow_state?: string | null;
  actor?: string;
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

function directoryExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function classifyRoute(input: {
  terminal: boolean;
  notPending: boolean;
  blocked: boolean;
  locked: boolean;
  missingProjectRoot: boolean;
  eligible: boolean;
  workflowPointerActive: boolean;
  workflowPointerTerminal: boolean;
}): TaskRouteClass {
  if (input.terminal) return "terminal";
  if (input.notPending) return "in_progress";
  if (input.blocked) return "blocked";
  if (input.locked) return "locked";
  if (input.missingProjectRoot) return "missing_metadata";
  if (!input.eligible) return "unroutable";
  if (input.workflowPointerActive) return "deduped_active";
  if (input.workflowPointerTerminal) return "terminal_requeue_needed";
  return "eligible";
}

export function getTaskRouteState(
  taskOrId: Task | string,
  db?: Database,
  options: GetTaskRouteStateOptions = {},
): TaskRouteState {
  const d = getDatabase(db);
  const task = typeof taskOrId === "string" ? getTask(taskOrId, d) : taskOrId;
  if (!task) throw new Error(`Task not found: ${taskOrId}`);

  const { project, projectPath } = resolveProject(task, d);
  const taskList = resolveTaskList(task, project, d);
  const automation = routingAutomationMetadata(task, taskList) ?? {};
  // Authoritative route-enable resolution: an explicit route_enabled (task, then
  // task list) always wins — true enables, false denies even with the auto:route
  // tag present. When route_enabled is unset, the auto:route/route:enabled tag is
  // the opt-in signal the OpenLoops drain routes on, so route_state honours it and
  // eligibility is computed the same single way the drain admits work (rather than
  // reporting route_not_enabled for a task the drain will happily route).
  const explicitRouteEnabled = routeEnabledForTask(task, taskList);
  const tagOptIn = task.tags.includes("auto:route") || task.tags.includes("route:enabled");
  const routeEnabled = explicitRouteEnabled === undefined ? tagOptIn : explicitRouteEnabled;
  // The fleet gates automation with the `no-auto` tag (the drain's invalid-path
  // remediation adds it), so route_state must honour that tag as a deny signal —
  // symmetric to the auto:route enable — otherwise an auto:route+no-auto task would
  // be silently treated as a normal candidate.
  const tagNoAuto = task.tags.includes("no-auto") || task.tags.includes("noauto") || task.tags.includes("no:auto");
  const projectKind = projectKindFromMetadata(task.metadata, taskList?.metadata);
  const locked = Boolean(task.locked_by && !isLockExpired(task.locked_at));
  const blockers = getBlockingDeps(task.id, d);
  const blocked = blockers.length > 0;
  const terminal = isTerminal(task.status);
  const requiresApproval = automation.requires_approval === true || task.requires_approval === true;
  const approvalRequired = automation.approval_required === true;
  const approved = Boolean(task.approved_by);

  const pointers = workflowPointersFromMetadata(task.metadata);
  const workflowState = (pointers.workflow_state ?? "").trim().toLowerCase();
  const hasWorkflowPointer = Boolean(
    pointers.current_workflow_invocation_id || pointers.current_run_id || workflowState,
  );
  const workflowPointerTerminal = hasWorkflowPointer && TERMINAL_WORKFLOW_STATES.has(workflowState);
  const workflowPointerActive = hasWorkflowPointer && !workflowPointerTerminal;

  // Optional machine-local project-root verification, mirroring the drain's
  // "projectPath must be an existing directory" admission check. Off by default so
  // pure DB evaluations stay deterministic and machine-independent.
  const verifyProjectRoot = options.verifyProjectRoot === true;
  let projectRootExists: boolean | null = null;
  if (verifyProjectRoot) {
    projectRootExists = projectPath ? directoryExists(projectPath) : false;
  }
  const missingProjectRoot = verifyProjectRoot && projectRootExists !== true;

  const gates: TaskRouteGates = {
    route_enabled: routeEnabled,
    tag_opt_in: tagOptIn,
    no_auto: automation.no_auto === true || tagNoAuto,
    manual: automation.manual === true,
    manual_required: automation.manual_required === true,
    requires_approval: requiresApproval,
    approval_required: approvalRequired,
    approved,
    locked,
    blocked,
    terminal,
    missing_project_root: missingProjectRoot,
    workflow_pointer_active: workflowPointerActive,
    workflow_pointer_terminal: workflowPointerTerminal,
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
  if (missingProjectRoot) reasons.push("missing_project_root");

  const eligible = reasons.length === 0;

  const staleAfterMs = options.staleInProgressAfterMs ?? DEFAULT_STALE_IN_PROGRESS_MS;
  const updatedAtMs = Date.parse(task.updated_at);
  const ageMs = Number.isNaN(updatedAtMs) ? 0 : Math.max(0, Date.now() - updatedAtMs);
  const evidence: TaskRouteEvidence = {
    owner: task.assigned_to ?? task.locked_by ?? null,
    assigned_to: task.assigned_to ?? null,
    locked_by: task.locked_by ?? null,
    locked_at: task.locked_at ?? null,
    updated_at: task.updated_at,
    age_ms: ageMs,
    stale: task.status === "in_progress" && ageMs > staleAfterMs,
    stale_after_ms: staleAfterMs,
    current_run_id: pointers.current_run_id ?? null,
    current_workflow_invocation_id: pointers.current_workflow_invocation_id ?? null,
    workflow_state: pointers.workflow_state ?? null,
    project_root_verified: verifyProjectRoot,
    project_root_exists: projectRootExists,
  };

  const route_class = classifyRoute({
    terminal,
    notPending: task.status !== "pending",
    blocked,
    locked,
    missingProjectRoot,
    eligible,
    workflowPointerActive,
    workflowPointerTerminal,
  });

  return {
    schema_version: TODOS_TASK_ROUTE_STATE_SCHEMA_VERSION,
    task_id: task.id,
    task_short_id: task.short_id,
    status: task.status,
    eligible,
    route_class,
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
      project_kind: projectKind,
      task_list_id: taskList?.id ?? task.task_list_id,
      task_list_slug: taskList?.slug ?? null,
      task_list_name: taskList?.name ?? null,
      concurrency_key: routeConcurrencyKey(task, project, taskList, projectPath),
    },
    pointers,
    evidence,
  };
}

export function setTaskWorkflowPointers(
  taskId: string,
  input: SetTaskWorkflowPointersInput,
  db?: Database,
): Task {
  const d = getDatabase(db);
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
  if (value === undefined) return previous;
  return typeof value === "string" && value.trim() ? value : undefined;
}
