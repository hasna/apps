import type { Database } from "bun:sqlite";
import { getTask, listTasks, updateTask } from "../db/tasks.js";
import type { Task, TaskStatus } from "../types/index.js";
import { TASK_STATUSES, TaskNotFoundError, VersionConflictError } from "../types/index.js";
import { getDatabase } from "../db/database.js";
import { loadConfig } from "./config.js";
import type { LocalWorkflowStatesConfig, WorkflowStateConfig } from "./config.js";
import { getTaskLocalFields } from "./local-fields.js";

export interface WorkflowState extends Omit<WorkflowStateConfig, "aliases" | "transitions" | "terminal"> {
  aliases: string[];
  transitions: string[] | null;
  terminal: boolean;
}

export interface WorkflowStateResolution {
  input: string;
  state: WorkflowState;
  matched_by: "name" | "alias" | "canonical_status";
}

export interface SetTaskWorkflowStateOptions {
  actor?: string;
  project_path?: string;
  force?: boolean;
}

export interface TaskWorkflowStateResult {
  task: Task;
  workflow_state: WorkflowState;
  previous_workflow_state: WorkflowState;
  changed: boolean;
  canonical_status_changed: boolean;
  local_only: true;
}

export interface WorkflowStateQuery {
  state: string;
  project_id?: string;
  task_list_id?: string;
  project_path?: string;
  limit?: number;
}

export interface WorkflowStateQueryResult {
  state: WorkflowState;
  tasks: Task[];
  count: number;
  local_only: true;
}

export interface WorkflowStateMigrationOptions {
  apply?: boolean;
  project_id?: string;
  task_list_id?: string;
  project_path?: string;
  limit?: number;
}

export interface WorkflowStateMigrationItem {
  task_id: string;
  short_id: string | null;
  title: string;
  canonical_status: TaskStatus;
  workflow_state: string;
  changed: boolean;
}

export interface WorkflowStateMigrationReport {
  applied: boolean;
  migrated_count: number;
  pending_count: number;
  skipped_count: number;
  items: WorkflowStateMigrationItem[];
  local_only: true;
}

const LOCAL_FIELDS_KEY = "local_fields";
const WORKFLOW_STATE_KEY = "workflow_state";

const DEFAULT_WORKFLOW_STATES: WorkflowState[] = [
  { name: "pending", canonical_status: "pending", aliases: ["todo", "backlog"], transitions: null, terminal: false },
  { name: "in_progress", canonical_status: "in_progress", aliases: ["doing", "started"], transitions: null, terminal: false },
  { name: "completed", canonical_status: "completed", aliases: ["done", "complete"], transitions: null, terminal: true },
  { name: "failed", canonical_status: "failed", aliases: [], transitions: null, terminal: true },
  { name: "cancelled", canonical_status: "cancelled", aliases: ["canceled"], transitions: null, terminal: true },
];

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

function normalizeState(input: WorkflowStateConfig): WorkflowState | null {
  const name = normalizeName(input.name || "");
  if (!name || !isTaskStatus(input.canonical_status)) return null;
  const aliases = [...new Set((input.aliases || []).map(normalizeName).filter((alias) => alias && alias !== name))].sort();
  const transitions = input.transitions
    ? [...new Set(input.transitions.map(normalizeName).filter(Boolean))].sort()
    : null;
  return {
    name,
    canonical_status: input.canonical_status,
    aliases,
    description: input.description,
    transitions,
    terminal: input.terminal ?? (input.canonical_status === "completed" || input.canonical_status === "failed" || input.canonical_status === "cancelled"),
    color: input.color,
  };
}

function mergeWorkflowConfig(config?: LocalWorkflowStatesConfig): WorkflowState[] {
  const states = new Map(DEFAULT_WORKFLOW_STATES.map((state) => [state.name, state]));
  for (const input of config?.states || []) {
    const state = normalizeState(input);
    if (state) states.set(state.name, state);
  }
  return [...states.values()];
}

function getWorkflowConfig(projectPath?: string | null): LocalWorkflowStatesConfig | undefined {
  const config = loadConfig();
  return projectPath && config.project_overrides?.[projectPath]?.workflow_states
    ? config.project_overrides[projectPath].workflow_states
    : config.workflow_states;
}

export function listWorkflowStates(projectPath?: string | null): WorkflowState[] {
  const workflowConfig = getWorkflowConfig(projectPath);
  return mergeWorkflowConfig(workflowConfig);
}

export function resolveWorkflowState(input: string, projectPath?: string | null): WorkflowStateResolution {
  const normalized = normalizeName(input);
  const states = listWorkflowStates(projectPath);
  const byName = states.find((state) => state.name === normalized);
  if (byName) return { input, state: byName, matched_by: "name" };
  const byAlias = states.find((state) => state.aliases.includes(normalized));
  if (byAlias) return { input, state: byAlias, matched_by: "alias" };
  const byCanonical = states.find((state) => state.canonical_status === normalized);
  if (byCanonical) return { input, state: byCanonical, matched_by: "canonical_status" };
  throw new Error(`Unknown workflow state: ${input}`);
}

function stateForCanonicalStatus(status: TaskStatus, projectPath?: string | null): WorkflowState {
  const configured = (getWorkflowConfig(projectPath)?.states || [])
    .map(normalizeState)
    .find((state): state is WorkflowState => Boolean(state && state.canonical_status === status));
  if (configured) return configured;
  return listWorkflowStates(projectPath).find((state) => state.canonical_status === status)
    || resolveWorkflowState(status, projectPath).state;
}

export function getTaskWorkflowState(taskId: string, db?: Database, projectPath?: string | null): WorkflowState {
  const d = db || getDatabase();
  const task = getTask(taskId, d);
  if (!task) throw new TaskNotFoundError(taskId);
  const fields = getTaskLocalFields(taskId, d);
  const stored = fields.custom[WORKFLOW_STATE_KEY];
  if (typeof stored === "string") {
    try {
      const state = resolveWorkflowState(stored, projectPath).state;
      if (state.canonical_status === task.status) return state;
    } catch {
      // Fall through to canonical state if local metadata is stale.
    }
  }
  return stateForCanonicalStatus(task.status, projectPath);
}

function assertAllowedTransition(from: WorkflowState, to: WorkflowState, force?: boolean): void {
  if (force || from.name === to.name) return;
  if (from.transitions === null) return;
  if (from.transitions.includes(to.name)) return;
  throw new Error(`Cannot transition workflow state from ${from.name} to ${to.name}`);
}

function metadataWithWorkflowState(task: Task, stateName: string, db: Database): Record<string, unknown> {
  const fields = getTaskLocalFields(task.id, db);
  return {
    ...task.metadata,
    [LOCAL_FIELDS_KEY]: {
      ...fields,
      custom: {
        ...fields.custom,
        [WORKFLOW_STATE_KEY]: stateName,
      },
    },
  };
}

export function setTaskWorkflowState(
  taskId: string,
  stateInput: string,
  options: SetTaskWorkflowStateOptions = {},
  db?: Database,
): TaskWorkflowStateResult {
  const d = db || getDatabase();
  const target = resolveWorkflowState(stateInput, options.project_path).state;
  for (let attempt = 0; attempt < 3; attempt++) {
    const task = getTask(taskId, d);
    if (!task) throw new TaskNotFoundError(taskId);
    const previous = getTaskWorkflowState(task.id, d, options.project_path);
    assertAllowedTransition(previous, target, options.force);
    const metadata = metadataWithWorkflowState(task, target.name, d);
    try {
      const updated = updateTask(task.id, {
        version: task.version,
        status: target.canonical_status,
        metadata: {
          ...metadata,
          workflow_state_updated_by: options.actor || null,
        },
      }, d);
      return {
        task: updated,
        workflow_state: target,
        previous_workflow_state: previous,
        changed: previous.name !== target.name,
        canonical_status_changed: task.status !== target.canonical_status,
        local_only: true,
      };
    } catch (error) {
      if (error instanceof VersionConflictError && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Failed to set workflow state after 3 attempts");
}

export function queryTasksByWorkflowState(query: WorkflowStateQuery, db?: Database): WorkflowStateQueryResult {
  const d = db || getDatabase();
  const target = resolveWorkflowState(query.state, query.project_path).state;
  const tasks = listTasks({
    project_id: query.project_id,
    task_list_id: query.task_list_id,
    status: target.canonical_status,
    limit: 10000,
  }, d).filter((task) => getTaskWorkflowState(task.id, d, query.project_path).name === target.name)
    .slice(0, query.limit || 100);
  return { state: target, tasks, count: tasks.length, local_only: true };
}

export function migrateWorkflowStates(options: WorkflowStateMigrationOptions = {}, db?: Database): WorkflowStateMigrationReport {
  const d = db || getDatabase();
  const tasks = listTasks({
    project_id: options.project_id,
    task_list_id: options.task_list_id,
    limit: options.limit || 10000,
    include_archived: true,
  }, d);
  const items: WorkflowStateMigrationItem[] = [];
  let migrated = 0;
  for (const task of tasks) {
    const target = stateForCanonicalStatus(task.status, options.project_path);
    const current = getTaskWorkflowState(task.id, d, options.project_path);
    const changed = current.name !== target.name || getTaskLocalFields(task.id, d).custom[WORKFLOW_STATE_KEY] !== target.name;
    items.push({
      task_id: task.id,
      short_id: task.short_id,
      title: task.title,
      canonical_status: task.status,
      workflow_state: target.name,
      changed,
    });
    if (options.apply && changed) {
      setTaskWorkflowState(task.id, target.name, { project_path: options.project_path, force: true }, d);
      migrated += 1;
    }
  }
  return {
    applied: Boolean(options.apply),
    migrated_count: migrated,
    pending_count: options.apply ? 0 : items.filter((item) => item.changed).length,
    skipped_count: items.filter((item) => !item.changed).length,
    items,
    local_only: true,
  };
}

export function renderWorkflowStatesMarkdown(states = listWorkflowStates()): string {
  return [
    "# Workflow States",
    "",
    "| State | Canonical status | Aliases | Transitions | Terminal |",
    "| --- | --- | --- | --- | --- |",
    ...states.map((state) => `| ${state.name} | ${state.canonical_status} | ${state.aliases.join(", ") || "-"} | ${state.transitions?.join(", ") || "any"} | ${state.terminal ? "yes" : "no"} |`),
  ].join("\n");
}
