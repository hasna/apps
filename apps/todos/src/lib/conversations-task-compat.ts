import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import type { Database as TodosDatabase } from "bun:sqlite";
import { logTaskChange } from "../db/audit.js";
import { getDatabase } from "../db/database.js";
import {
  createTask,
  getTask,
  getTaskByFingerprint,
  listTasks,
  updateTask,
} from "../db/tasks.js";
import type { Task, TaskPriority, TaskStatus } from "../types/index.js";

export const CONVERSATIONS_TASK_COMPAT_SCHEMA_VERSION = 1;

export type LegacyConversationsTaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "blocked";

export interface LegacyConversationsTask {
  id?: number | string;
  uuid?: string;
  subject: string;
  description?: string | null;
  status?: LegacyConversationsTaskStatus;
  priority?: TaskPriority;
  assignee?: string | null;
  reporter?: string | null;
  project_id?: string | null;
  channel?: string | null;
  parent_id?: number | string | null;
  depends_on?: Array<number | string> | string | null;
  tags?: string[] | string | null;
  metadata?: Record<string, unknown> | string | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  due_at?: string | null;
  /** Optional pointer written by an earlier Conversations compatibility shim. */
  todos_task_id?: string | null;
}

export interface LegacyConversationsHistoryPointer {
  id: number | string;
  task_id: number | string;
}

export interface LegacyConversationsDependencyPointer {
  task_id: number | string;
  depends_on_id: number | string;
}

export interface LegacyConversationsTaskBundle {
  tasks: LegacyConversationsTask[];
  task_activity?: LegacyConversationsHistoryPointer[];
  task_comments?: LegacyConversationsHistoryPointer[];
  task_dependencies?: LegacyConversationsDependencyPointer[];
  source?: string | null;
}

export interface ConversationsTaskReference {
  id?: number | string | null;
  uuid?: string | null;
  todos_task_id?: string | null;
}

export type ConversationsTaskLookupStatus = "resolved" | "missing" | "stale" | "conflict";

export interface ConversationsTaskLookupResult {
  schema_version: 1;
  status: ConversationsTaskLookupStatus;
  reference: ConversationsTaskReference;
  task: Task | null;
  stale_todos_task_id: string | null;
  conflicting_task_ids: string[];
}

export type ConversationsTaskMigrationAction = "create" | "update" | "unchanged" | "skip";

export interface ConversationsTaskMigrationItem {
  source_ref: string;
  action: ConversationsTaskMigrationAction;
  task_id: string | null;
  stale_todos_task_id: string | null;
  warnings: string[];
}

export interface ConversationsTaskMissingReference {
  source_ref: string;
  field: "parent_id" | "depends_on" | "task_activity.task_id" | "task_comments.task_id" | "task_dependencies.task_id";
  missing_ref: string;
}

export interface ConversationsTaskMigrationResult {
  schema_version: 1;
  source: "conversations";
  source_location: string | null;
  dry_run: boolean;
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  items: ConversationsTaskMigrationItem[];
  missing_refs: ConversationsTaskMissingReference[];
  stale_refs: Array<{ source_ref: string; todos_task_id: string }>;
}

export interface MigrateConversationsTasksOptions {
  apply?: boolean;
  source?: string | null;
}

interface NormalizedLegacyTask {
  record: LegacyConversationsTask;
  id: string | null;
  uuid: string | null;
  sourceRef: string;
  fingerprint: string;
  externalRefs: string[];
  originalMetadata: Record<string, unknown>;
  todosTaskId: string | null;
  tags: string[];
  dependencies: string[];
}

interface HistoryPointers {
  activity_ids: Array<number | string>;
  comment_ids: Array<number | string>;
}

interface PreparedTask {
  normalized: NormalizedLegacyTask;
  existing: Task | null;
  staleTodosTaskId: string | null;
  conflictTaskIds: string[];
  input: {
    title: string;
    description: string | undefined;
    status: TaskStatus;
    priority: TaskPriority;
    agent_id: string | undefined;
    assigned_to: string | undefined;
    tags: string[];
    metadata: Record<string, unknown>;
    due_at: string | undefined;
  };
  action: Exclude<ConversationsTaskMigrationAction, "skip">;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(nonEmptyString).filter((item): item is string => item !== null);
  }
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return stringArray(parsed);
  } catch {
    // Older Conversations rows may contain a comma-delimited value.
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function referenceKey(value: number | string | null | undefined): string | null {
  return nonEmptyString(value)?.toLowerCase() ?? null;
}

function normalizeUuid(value: unknown): string | null {
  const uuid = nonEmptyString(value);
  return uuid ? uuid.toLowerCase() : null;
}

function sourceRef(id: string | null, uuid: string | null): string {
  return uuid ? `conversations:task:${uuid}` : `conversations:task:id:${id}`;
}

function legacyExternalRefs(id: string | null, uuid: string | null): string[] {
  return unique([
    uuid ? `conversations:task:${uuid}` : null,
    uuid ? `conversations://tasks/${uuid}` : null,
    id ? `conversations:task:id:${id}` : null,
    id ? `conversations://tasks/id/${id}` : null,
  ]);
}

function extractTodosTaskId(record: LegacyConversationsTask, metadata: Record<string, unknown>): string | null {
  return nonEmptyString(record.todos_task_id)
    ?? nonEmptyString(metadata["todos_task_id"])
    ?? nonEmptyString(metadata["todosTaskId"]);
}

function normalizeLegacyTask(record: LegacyConversationsTask): NormalizedLegacyTask {
  const id = referenceKey(record.id);
  const uuid = normalizeUuid(record.uuid);
  const subject = nonEmptyString(record.subject);
  if (!subject) throw new Error("Conversations task subject is required");
  if (!id && !uuid) throw new Error(`Conversations task "${subject}" requires id or uuid`);
  const originalMetadata = objectValue(record.metadata);
  const externalRefs = unique([
    ...legacyExternalRefs(id, uuid),
    ...stringArray(originalMetadata["external_refs"]),
  ]);
  return {
    record: { ...record, subject },
    id,
    uuid,
    sourceRef: sourceRef(id, uuid),
    fingerprint: uuid ? `conversations:task:${uuid}` : `conversations:task:id:${id}`,
    externalRefs,
    originalMetadata,
    todosTaskId: extractTodosTaskId(record, originalMetadata),
    tags: stringArray(record.tags),
    dependencies: stringArray(record.depends_on).map((value) => value.toLowerCase()),
  };
}

function referenceFromUnknown(reference: number | string | ConversationsTaskReference): ConversationsTaskReference {
  if (typeof reference === "number") return { id: String(reference) };
  if (typeof reference !== "string") {
    return {
      id: nonEmptyString(reference.id),
      uuid: normalizeUuid(reference.uuid),
      todos_task_id: nonEmptyString(reference.todos_task_id),
    };
  }
  const raw = reference.trim();
  const uriId = raw.match(/^conversations:\/\/tasks\/id\/(.+)$/i)?.[1];
  const uri = raw.match(/^conversations:\/\/tasks\/(.+)$/i)?.[1];
  const explicitId = raw.match(/^conversations:task:id:(.+)$/i)?.[1];
  const explicit = raw.match(/^conversations:task:(.+)$/i)?.[1];
  if (uriId || explicitId) return { id: (uriId ?? explicitId)!.trim() };
  if (uri || explicit) return { uuid: (uri ?? explicit)!.trim().toLowerCase() };
  if (/^#?\d+$/.test(raw)) return { id: raw.replace(/^#/, "") };
  return { uuid: raw.toLowerCase() };
}

function mappedTasks(reference: ConversationsTaskReference, db: TodosDatabase): Task[] {
  const matches = new Map<string, Task>();
  const uuid = normalizeUuid(reference.uuid);
  const id = referenceKey(reference.id);
  if (uuid) {
    const byFingerprint = getTaskByFingerprint(`conversations:task:${uuid}`, db);
    if (byFingerprint) matches.set(byFingerprint.id, byFingerprint);
    for (const task of listTasks({ metadata: { conversations_task_uuid: uuid }, include_archived: true, limit: 2 }, db)) {
      matches.set(task.id, task);
    }
  }
  if (id) {
    const byFingerprint = getTaskByFingerprint(`conversations:task:id:${id}`, db);
    if (byFingerprint) matches.set(byFingerprint.id, byFingerprint);
    for (const candidate of [id, Number(id)]) {
      if (typeof candidate === "number" && !Number.isFinite(candidate)) continue;
      for (const task of listTasks({ metadata: { conversations_task_id: candidate }, include_archived: true, limit: 2 }, db)) {
        matches.set(task.id, task);
      }
    }
  }
  return [...matches.values()];
}

/**
 * Resolve a Conversations numeric id, 32-hex uuid, URI, or prior Todos pointer
 * without consulting the Conversations store. The returned Todos row is the
 * compatibility source of truth after migration.
 */
export function resolveConversationsTaskReference(
  reference: number | string | ConversationsTaskReference,
  db?: TodosDatabase,
): ConversationsTaskLookupResult {
  const d = db ?? getDatabase();
  const parsed = referenceFromUnknown(reference);
  const pointedId = nonEmptyString(parsed.todos_task_id);
  const pointedTask = pointedId ? getTask(pointedId, d) : null;
  const mapped = mappedTasks(parsed, d);
  if (pointedTask) mapped.unshift(pointedTask);
  const distinct = [...new Map(mapped.map((task) => [task.id, task])).values()];
  const staleTodosTaskId = pointedId && !pointedTask ? pointedId : null;

  if (distinct.length > 1) {
    return {
      schema_version: CONVERSATIONS_TASK_COMPAT_SCHEMA_VERSION,
      status: "conflict",
      reference: parsed,
      task: null,
      stale_todos_task_id: staleTodosTaskId,
      conflicting_task_ids: distinct.map((task) => task.id),
    };
  }
  if (distinct.length === 1) {
    return {
      schema_version: CONVERSATIONS_TASK_COMPAT_SCHEMA_VERSION,
      status: "resolved",
      reference: parsed,
      task: distinct[0]!,
      stale_todos_task_id: staleTodosTaskId,
      conflicting_task_ids: [],
    };
  }
  return {
    schema_version: CONVERSATIONS_TASK_COMPAT_SCHEMA_VERSION,
    status: staleTodosTaskId ? "stale" : "missing",
    reference: parsed,
    task: null,
    stale_todos_task_id: staleTodosTaskId,
    conflicting_task_ids: [],
  };
}

function mapStatus(status: LegacyConversationsTaskStatus | undefined): TaskStatus {
  // Conversations represented dependency blocking as a stored task status.
  // Todos derives blocking from dependency edges, so retain the source status in
  // metadata and import the writable task state as pending.
  if (!status || status === "blocked") return "pending";
  return status;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function same(value: unknown, expected: unknown): boolean {
  return canonicalJson(value) === canonicalJson(expected);
}

function sourceHistoryPointers(
  normalized: NormalizedLegacyTask,
  pointers: HistoryPointers,
  sourceLocation: string | null,
): Record<string, unknown> {
  const key = normalized.uuid ?? `id/${normalized.id}`;
  return {
    source: sourceLocation,
    activity_ref: `conversations://tasks/${key}/activity`,
    comments_ref: `conversations://tasks/${key}/comments`,
    activity_ids: pointers.activity_ids,
    comment_ids: pointers.comment_ids,
  };
}

function prepareTask(
  normalized: NormalizedLegacyTask,
  pointers: HistoryPointers,
  sourceLocation: string | null,
  db: TodosDatabase,
): PreparedTask {
  const lookup = resolveConversationsTaskReference({
    id: normalized.id,
    uuid: normalized.uuid,
    todos_task_id: normalized.todosTaskId,
  }, db);
  if (lookup.status === "conflict") {
    throw new Error(`Conflicting Todos mappings for ${normalized.sourceRef}: ${lookup.conflicting_task_ids.join(", ")}`);
  }
  const existing = lookup.task;
  const existingExternalRefs = stringArray(existing?.metadata["external_refs"]);
  const existingHistoryPointers = objectValue(existing?.metadata["history_pointers"]);
  const originalHistoryPointers = objectValue(normalized.originalMetadata["history_pointers"]);
  const metadata: Record<string, unknown> = {
    ...(existing?.metadata ?? {}),
    fingerprint: normalized.fingerprint,
    compatibility_source: "conversations",
    conversations_task_id: normalized.id,
    conversations_task_uuid: normalized.uuid,
    external_refs: unique([...existingExternalRefs, ...normalized.externalRefs]),
    history_pointers: {
      ...existingHistoryPointers,
      ...originalHistoryPointers,
      conversations: sourceHistoryPointers(normalized, pointers, sourceLocation),
    },
    conversations: {
      reporter: nonEmptyString(normalized.record.reporter),
      project_id: nonEmptyString(normalized.record.project_id),
      channel: nonEmptyString(normalized.record.channel),
      parent_ref: referenceKey(normalized.record.parent_id),
      dependency_refs: normalized.dependencies,
      original_status: normalized.record.status ?? "pending",
      created_at: nonEmptyString(normalized.record.created_at),
      started_at: nonEmptyString(normalized.record.started_at),
      completed_at: nonEmptyString(normalized.record.completed_at),
      cancelled_at: nonEmptyString(normalized.record.cancelled_at),
      metadata: normalized.originalMetadata,
    },
  };
  const input: PreparedTask["input"] = {
    title: normalized.record.subject,
    description: nonEmptyString(normalized.record.description) ?? undefined,
    status: mapStatus(normalized.record.status),
    priority: normalized.record.priority ?? "medium",
    agent_id: nonEmptyString(normalized.record.reporter) ?? undefined,
    assigned_to: nonEmptyString(normalized.record.assignee) ?? undefined,
    tags: normalized.tags,
    metadata,
    due_at: nonEmptyString(normalized.record.due_at) ?? undefined,
  };
  const unchanged = existing
    && existing.title === input.title
    && (existing.description ?? undefined) === input.description
    && existing.status === input.status
    && existing.priority === input.priority
    && (existing.agent_id ?? undefined) === input.agent_id
    && (existing.assigned_to ?? undefined) === input.assigned_to
    && same(existing.tags, input.tags)
    && same(existing.metadata, input.metadata)
    && (existing.due_at ?? undefined) === input.due_at;
  return {
    normalized,
    existing,
    staleTodosTaskId: lookup.stale_todos_task_id,
    conflictTaskIds: lookup.conflicting_task_ids,
    input,
    action: existing ? (unchanged ? "unchanged" : "update") : "create",
  };
}

function applyPreparedTask(prepared: PreparedTask, db: TodosDatabase): Task {
  if (prepared.action === "unchanged") return prepared.existing!;
  if (prepared.action === "create") {
    const task = createTask(prepared.input, db);
    logTaskChange(
      task.id,
      "imported",
      "external_ref",
      null,
      prepared.normalized.sourceRef,
      prepared.input.agent_id,
      db,
    );
    return task;
  }
  return updateTask(prepared.existing!.id, {
    version: prepared.existing!.version,
    title: prepared.input.title,
    description: prepared.input.description,
    status: prepared.input.status,
    priority: prepared.input.priority,
    assigned_to: prepared.input.assigned_to,
    tags: prepared.input.tags,
    metadata: prepared.input.metadata,
    due_at: prepared.input.due_at ?? null,
  }, db);
}

/** Create or update one legacy Conversations task by its stable source identity. */
export function upsertConversationsTask(
  record: LegacyConversationsTask,
  options: { source?: string | null } = {},
  db?: TodosDatabase,
): { task: Task; created: boolean; changed: boolean; stale_todos_task_id: string | null } {
  const d = db ?? getDatabase();
  const normalized = normalizeLegacyTask(record);
  const prepared = prepareTask(normalized, { activity_ids: [], comment_ids: [] }, options.source ?? null, d);
  const task = applyPreparedTask(prepared, d);
  return {
    task,
    created: prepared.action === "create",
    changed: prepared.action !== "unchanged",
    stale_todos_task_id: prepared.staleTodosTaskId,
  };
}

function bundleFromInput(input: LegacyConversationsTaskBundle | LegacyConversationsTask[]): LegacyConversationsTaskBundle {
  return Array.isArray(input) ? { tasks: input } : input;
}

function taskReferenceSet(tasks: NormalizedLegacyTask[]): Set<string> {
  const refs = new Set<string>();
  for (const task of tasks) {
    if (task.id) refs.add(task.id);
    if (task.uuid) refs.add(task.uuid);
  }
  return refs;
}

function historyPointersForTask(
  task: NormalizedLegacyTask,
  bundle: LegacyConversationsTaskBundle,
): HistoryPointers {
  const id = task.id;
  return {
    activity_ids: (bundle.task_activity ?? [])
      .filter((pointer) => referenceKey(pointer.task_id) === id)
      .map((pointer) => pointer.id),
    comment_ids: (bundle.task_comments ?? [])
      .filter((pointer) => referenceKey(pointer.task_id) === id)
      .map((pointer) => pointer.id),
  };
}

function missingReference(
  source: NormalizedLegacyTask,
  field: ConversationsTaskMissingReference["field"],
  value: number | string,
  known: Set<string>,
  db: TodosDatabase,
): ConversationsTaskMissingReference | null {
  const ref = referenceKey(value);
  if (!ref || known.has(ref)) return null;
  const lookup = resolveConversationsTaskReference(ref, db);
  if (lookup.status === "resolved") return null;
  return { source_ref: source.sourceRef, field, missing_ref: ref };
}

/**
 * Plan or apply an idempotent Conversations task migration. Dry-run is the
 * default. Missing relationship/history refs are reported, while the valid task
 * rows remain independently migratable.
 */
export function migrateConversationsTasks(
  input: LegacyConversationsTaskBundle | LegacyConversationsTask[],
  options: MigrateConversationsTasksOptions = {},
  db?: TodosDatabase,
): ConversationsTaskMigrationResult {
  const d = db ?? getDatabase();
  const bundle = bundleFromInput(input);
  const sourceLocation = options.source ?? bundle.source ?? null;
  const normalized: NormalizedLegacyTask[] = [];
  const items: ConversationsTaskMigrationItem[] = [];

  for (const record of bundle.tasks ?? []) {
    try {
      normalized.push(normalizeLegacyTask(record));
    } catch (error) {
      items.push({
        source_ref: nonEmptyString(record?.uuid) ?? nonEmptyString(record?.id) ?? "unknown",
        action: "skip",
        task_id: null,
        stale_todos_task_id: null,
        warnings: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  const known = taskReferenceSet(normalized);
  const missingRefs: ConversationsTaskMissingReference[] = [];
  for (const task of normalized) {
    if (task.record.parent_id !== null && task.record.parent_id !== undefined) {
      const missing = missingReference(task, "parent_id", task.record.parent_id, known, d);
      if (missing) missingRefs.push(missing);
    }
    const dependencyRefs = unique([
      ...task.dependencies,
      ...(bundle.task_dependencies ?? [])
        .filter((pointer) => referenceKey(pointer.task_id) === task.id)
        .map((pointer) => referenceKey(pointer.depends_on_id)),
    ]);
    task.dependencies = dependencyRefs;
    for (const dependency of dependencyRefs) {
      const missing = missingReference(task, "depends_on", dependency, known, d);
      if (missing) missingRefs.push(missing);
    }
  }

  for (const [field, pointers] of [
    ["task_activity.task_id", bundle.task_activity ?? []],
    ["task_comments.task_id", bundle.task_comments ?? []],
    ["task_dependencies.task_id", bundle.task_dependencies ?? []],
  ] as const) {
    for (const pointer of pointers) {
      const ref = referenceKey(pointer.task_id);
      if (ref && !known.has(ref)) {
        missingRefs.push({
          source_ref: `conversations:task:id:${ref}`,
          field,
          missing_ref: ref,
        });
      }
    }
  }

  for (const task of normalized) {
    try {
      const prepared = prepareTask(task, historyPointersForTask(task, bundle), sourceLocation, d);
      const warnings = missingRefs
        .filter((missing) => missing.source_ref === task.sourceRef)
        .map((missing) => `Missing ${missing.field} reference ${missing.missing_ref}`);
      const applied = options.apply ? applyPreparedTask(prepared, d) : prepared.existing;
      items.push({
        source_ref: task.sourceRef,
        action: prepared.action,
        task_id: applied?.id ?? prepared.existing?.id ?? null,
        stale_todos_task_id: prepared.staleTodosTaskId,
        warnings,
      });
    } catch (error) {
      items.push({
        source_ref: task.sourceRef,
        action: "skip",
        task_id: null,
        stale_todos_task_id: task.todosTaskId,
        warnings: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  const count = (action: ConversationsTaskMigrationAction) => items.filter((item) => item.action === action).length;
  return {
    schema_version: CONVERSATIONS_TASK_COMPAT_SCHEMA_VERSION,
    source: "conversations",
    source_location: sourceLocation,
    dry_run: !options.apply,
    scanned: bundle.tasks?.length ?? 0,
    created: count("create"),
    updated: count("update"),
    unchanged: count("unchanged"),
    skipped: count("skip"),
    items,
    missing_refs: missingRefs,
    stale_refs: items
      .filter((item): item is ConversationsTaskMigrationItem & { stale_todos_task_id: string } => Boolean(item.stale_todos_task_id))
      .map((item) => ({ source_ref: item.source_ref, todos_task_id: item.stale_todos_task_id })),
  };
}

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

/** Read the legacy Conversations SQLite task tables without modifying the file. */
export function readLegacyConversationsTaskBundle(databasePath: string): LegacyConversationsTaskBundle {
  const path = resolve(databasePath);
  if (!existsSync(path)) throw new Error(`Conversations database not found: ${path}`);
  const source = new Database(path, { readonly: true, strict: true });
  try {
    if (!tableExists(source, "tasks")) throw new Error(`Conversations tasks table not found: ${path}`);
    const tasks = source.query("SELECT * FROM tasks ORDER BY id").all() as LegacyConversationsTask[];
    const taskActivity = tableExists(source, "task_activity")
      ? source.query("SELECT id, task_id FROM task_activity ORDER BY id").all() as LegacyConversationsHistoryPointer[]
      : [];
    const taskComments = tableExists(source, "task_comments")
      ? source.query("SELECT id, task_id FROM task_comments ORDER BY id").all() as LegacyConversationsHistoryPointer[]
      : [];
    const taskDependencies = tableExists(source, "task_dependencies")
      ? source.query("SELECT task_id, depends_on_id FROM task_dependencies ORDER BY task_id, depends_on_id").all() as LegacyConversationsDependencyPointer[]
      : [];
    return {
      tasks,
      task_activity: taskActivity,
      task_comments: taskComments,
      task_dependencies: taskDependencies,
      source: path,
    };
  } finally {
    source.close();
  }
}
