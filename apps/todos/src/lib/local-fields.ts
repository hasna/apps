import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { getTask, listTasks, updateTask } from "../db/tasks.js";
import type { UpdateTaskInput } from "../types/index.js";
import type { Task, TaskPriority } from "../types/index.js";
import { TaskNotFoundError } from "../types/index.js";
import { redactValue } from "./redaction.js";

export type LocalTaskSeverity = "s0" | "s1" | "s2" | "s3" | "s4" | string;

export interface LocalTaskFields {
  labels: string[];
  priority: TaskPriority;
  severity: LocalTaskSeverity | null;
  owner: string | null;
  area: string | null;
  custom: Record<string, unknown>;
}

export interface SetTaskLocalFieldsInput {
  labels?: string[];
  priority?: TaskPriority;
  severity?: LocalTaskSeverity | null;
  owner?: string | null;
  area?: string | null;
  custom?: Record<string, unknown>;
  merge_custom?: boolean;
}

export interface LocalTaskFieldQuery {
  labels?: string[];
  priority?: TaskPriority | TaskPriority[];
  severity?: LocalTaskSeverity;
  owner?: string;
  area?: string;
  custom?: Record<string, unknown>;
  limit?: number;
}

const LOCAL_FIELDS_KEY = "local_fields";

function normalizeList(values: string[] | undefined): string[] {
  return [...new Set((values || []).map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function metadataFields(task: Task): Partial<LocalTaskFields> {
  const value = task.metadata[LOCAL_FIELDS_KEY];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Partial<LocalTaskFields> : {};
}

function sameCustomValue(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function hasOwnField(fields: Partial<LocalTaskFields>, key: keyof LocalTaskFields): boolean {
  return Object.prototype.hasOwnProperty.call(fields, key);
}

export function getTaskLocalFields(taskId: string, db?: Database): LocalTaskFields {
  const d = db || getDatabase();
  const task = getTask(taskId, d);
  if (!task) throw new TaskNotFoundError(taskId);
  const fields = metadataFields(task);
  return {
    labels: normalizeList(fields.labels),
    priority: task.priority,
    severity: typeof fields.severity === "string" ? fields.severity : null,
    owner: hasOwnField(fields, "owner") ? (typeof fields.owner === "string" ? fields.owner : null) : task.assigned_to,
    area: typeof fields.area === "string" ? fields.area : null,
    custom: fields.custom && typeof fields.custom === "object" && !Array.isArray(fields.custom) ? fields.custom : {},
  };
}

export function setTaskLocalFields(
  taskId: string,
  input: SetTaskLocalFieldsInput,
  db?: Database,
): Task {
  const d = db || getDatabase();
  const task = getTask(taskId, d);
  if (!task) throw new TaskNotFoundError(taskId);
  const currentFields = getTaskLocalFields(taskId, d);
  const labels = input.labels !== undefined ? normalizeList(input.labels) : currentFields.labels;
  const custom = input.custom !== undefined
    ? redactValue(input.merge_custom === false ? input.custom : { ...currentFields.custom, ...input.custom })
    : currentFields.custom;
  const nextFields: LocalTaskFields = {
    labels,
    priority: input.priority || task.priority,
    severity: input.severity !== undefined ? input.severity : currentFields.severity,
    owner: input.owner !== undefined ? input.owner : currentFields.owner,
    area: input.area !== undefined ? input.area : currentFields.area,
    custom,
  };
  const nextMetadata = {
    ...task.metadata,
    [LOCAL_FIELDS_KEY]: nextFields,
  };
  const previousLabels = new Set(currentFields.labels);
  const nextTags = normalizeList([...task.tags.filter((tag) => !previousLabels.has(tag)), ...labels]);
  const updates: UpdateTaskInput = {
    version: task.version,
    priority: input.priority,
    tags: nextTags,
    metadata: nextMetadata,
  };
  if (input.owner !== undefined) updates.assigned_to = nextFields.owner as string;
  return updateTask(taskId, updates, d);
}

export function queryTasksByLocalFields(query: LocalTaskFieldQuery, db?: Database): Task[] {
  const d = db || getDatabase();
  const tasks = listTasks({
    priority: query.priority,
    tags: query.labels,
    limit: 10000,
  }, d);
  const matches = tasks.filter((task) => {
    const fields = getTaskLocalFields(task.id, d);
    if (query.labels && !query.labels.every((label) => fields.labels.includes(label))) return false;
    if (query.severity && fields.severity !== query.severity) return false;
    if (query.owner && fields.owner !== query.owner) return false;
    if (query.area && fields.area !== query.area) return false;
    if (query.custom) {
      for (const [key, expected] of Object.entries(query.custom)) {
        if (!sameCustomValue(fields.custom[key], expected)) return false;
      }
    }
    return true;
  });
  return matches.slice(0, query.limit || 100);
}
