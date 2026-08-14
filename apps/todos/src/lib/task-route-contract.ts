import type { Project, Task, TaskList } from "../types/index.js";

export const TODOS_TASK_ROUTE_STATE_SCHEMA_VERSION = "todos.task_route_state.v1";
export const TASK_WORKFLOW_POINTER_SCHEMA_VERSION = "todos.task_workflow_pointer.v1";

export interface TaskRoutingAutomationMetadata {
  allowed?: boolean;
  no_auto?: boolean;
  manual?: boolean;
  manual_required?: boolean;
  requires_approval?: boolean;
  approval_required?: boolean;
}

export interface TaskWorkflowPointers {
  current_workflow_invocation_id?: string;
  current_run_id?: string;
  latest_manifest_path?: string;
  latest_evaluation_path?: string;
  workflow_state?: string;
}

export interface ResolvedTaskRouteContext {
  project?: Project | null;
  projectPath?: string | null;
  taskList?: TaskList | null;
}

export function booleanField(value: unknown): boolean | undefined {
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

export function objectField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function collectBooleans(records: Array<Record<string, unknown> | undefined>, keys: string[]): boolean[] {
  const values: boolean[] = [];
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const value = booleanField(record[key]);
      if (value !== undefined) values.push(value);
    }
  }
  return values;
}

function mergedBoolean(records: Array<Record<string, unknown> | undefined>, keys: string[], trueWins: boolean): boolean | undefined {
  const values = collectBooleans(records, keys);
  if (values.length === 0) return undefined;
  if (trueWins) return values.some(Boolean);
  return values.includes(false) ? false : true;
}

export function routingAutomationMetadata(
  task: Pick<Task, "metadata" | "requires_approval">,
  taskList?: Pick<TaskList, "metadata"> | null,
): TaskRoutingAutomationMetadata | undefined {
  const taskAutomation = objectField(task.metadata.automation);
  const taskListAutomation = taskList ? objectField(taskList.metadata.automation) : undefined;
  const records = [task.metadata, taskAutomation, taskList?.metadata, taskListAutomation];

  const result: TaskRoutingAutomationMetadata = {};
  const aliases: Array<[keyof TaskRoutingAutomationMetadata, string[]]> = [
    ["allowed", ["allowed", "automation_allowed", "automationAllowed"]],
    ["no_auto", ["no_auto", "noAuto"]],
    ["manual", ["manual"]],
    ["manual_required", ["manual_required", "manualRequired"]],
    ["requires_approval", ["requires_approval", "requiresApproval"]],
    ["approval_required", ["approval_required", "approvalRequired"]],
  ];

  for (const [canonical, keys] of aliases) {
    const value = mergedBoolean(records, keys, canonical !== "allowed");
    if (value !== undefined) result[canonical] = value;
  }
  if (task.requires_approval) result.requires_approval = true;

  return Object.keys(result).length > 0 ? result : undefined;
}

export function routeEnabledForTask(task: Pick<Task, "metadata" | "tags">, taskList?: Pick<TaskList, "metadata"> | null): boolean | undefined {
  const explicit = booleanField(task.metadata.route_enabled);
  if (explicit !== undefined) return explicit;
  const taskListDefault = taskList ? booleanField(taskList.metadata.route_enabled) : undefined;
  if (taskListDefault !== undefined) return taskListDefault;
  return undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function workflowPointersFromMetadata(metadata: Record<string, unknown>): TaskWorkflowPointers {
  const nested = objectField(metadata.workflow_invocation) ?? objectField(metadata.workflow) ?? {};
  return {
    current_workflow_invocation_id:
      stringField(metadata.current_workflow_invocation_id) ?? stringField(nested.current_workflow_invocation_id) ?? stringField(nested.invocation_id),
    current_run_id:
      stringField(metadata.current_run_id) ?? stringField(nested.current_run_id) ?? stringField(nested.run_id),
    latest_manifest_path:
      stringField(metadata.latest_manifest_path) ?? stringField(nested.latest_manifest_path) ?? stringField(nested.manifest_path),
    latest_evaluation_path:
      stringField(metadata.latest_evaluation_path) ?? stringField(nested.latest_evaluation_path) ?? stringField(nested.evaluation_path),
    workflow_state:
      stringField(metadata.workflow_state) ?? stringField(nested.workflow_state) ?? stringField(nested.state),
  };
}

export function compactWorkflowPointers(pointers: TaskWorkflowPointers): TaskWorkflowPointers {
  return Object.fromEntries(
    Object.entries(pointers).filter(([, value]) => typeof value === "string" && value.length > 0),
  ) as TaskWorkflowPointers;
}

function metadataStringField(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function projectKindFromMetadata(...records: Array<Record<string, unknown> | undefined | null>): string | null {
  for (const record of records) {
    const value = metadataStringField(record ?? undefined, ["project_kind", "projectKind", "source_kind", "sourceKind"]);
    if (value) return value;
  }
  return null;
}

export function classifyProjectKind(_path: string, metadata?: Record<string, unknown> | null): string | null {
  return projectKindFromMetadata(metadata);
}

export function isWorktreePath(path: string): boolean {
  return path.includes("/.codewith/worktrees/") || path.includes("/.worktrees/");
}

export function inferRootProjectId(project: Project): string | null {
  return isWorktreePath(project.path) ? null : project.id;
}
