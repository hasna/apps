import type { Database, SQLQueryBindings } from "bun:sqlite";
import type {
  CreateTaskInput,
  Task,
  TaskFilter,
  TaskRow,
  TaskWithRelations,
  UpdateTaskInput,
  UpsertTaskByFingerprintInput,
  UpsertTaskByFingerprintResult,
} from "../types/index.js";
import {
  TaskNotFoundError,
  VersionConflictError,
} from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { checkCompletionGuard } from "../lib/completion-guard.js";
import { databasePathFromDatabase } from "../lib/event-emission-safety.js";
import { emitLocalEventHooksQuiet } from "../lib/event-hooks.js";
import { emitSharedTaskEventQuiet, taskEventData } from "../lib/shared-events.js";
import { logTaskChange } from "./audit.js";
import { dispatchWebhook } from "./webhooks.js";
import { getChecklist } from "./checklists.js";
import { currentStorageMachineId, recordStorageTombstone } from "./storage-tombstones.js";

// Re-export helpers for use by other modules
export function rowToTask(row: TaskRow): Task {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]") as string[],
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
    status: row.status as Task["status"],
    priority: row.priority as Task["priority"],
    requires_approval: !!row.requires_approval,
  };
}

export function insertTaskTags(taskId: string, tags: string[], db: Database): void {
  if (tags.length === 0) return;
  const stmt = db.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)");
  for (const tag of tags) {
    if (tag) stmt.run(taskId, tag);
  }
}

export function replaceTaskTags(taskId: string, tags: string[], db: Database): void {
  db.run("DELETE FROM task_tags WHERE task_id = ?", [taskId]);
  insertTaskTags(taskId, tags, db);
}

function addMetadataConditions(
  metadata: Record<string, unknown> | undefined,
  conditions: string[],
  params: SQLQueryBindings[],
): void {
  if (!metadata) return;
  for (const [key, value] of Object.entries(metadata)) {
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) {
      throw new Error(`Invalid metadata filter key: ${key}`);
    }
    conditions.push(`json_extract(metadata, '$."${key}"') = ?`);
    params.push(value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : JSON.stringify(value));
  }
}

export function createTask(input: CreateTaskInput, db?: Database): Task {
  const d = getDatabase(db);
  const timestamp = now();
  const tags = input.tags || [];
  const machineId = currentStorageMachineId(d);

  // assigned_by = who created this task (always the calling agent)
  // assigned_from_project = which project they were in when they assigned it
  const assignedBy = input.assigned_by || input.agent_id;
  const assignedFromProject = input.assigned_from_project || null;

  // Retry with a fresh UUID on the rare chance of a nanoid collision
  let id = uuid();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      d.run(
        `INSERT INTO tasks (id, short_id, project_id, parent_id, plan_id, task_list_id, cycle_id, title, description, status, priority, agent_id, assigned_to, session_id, working_dir, tags, metadata, version, created_at, updated_at, due_at, estimated_minutes, sla_minutes, confidence, retry_count, max_retries, retry_after, requires_approval, approved_by, approved_at, recurrence_rule, recurrence_parent_id, spawns_template_id, reason, spawned_from_session, assigned_by, assigned_from_project, task_type, machine_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          null,
          input.project_id || null,
          input.parent_id || null,
          input.plan_id || null,
          input.task_list_id || null,
          input.cycle_id || null,
          input.title,
          input.description || null,
          input.status || "pending",
          input.priority || "medium",
          input.agent_id || null,
          input.assigned_to || null,
          input.session_id || null,
          input.working_dir || null,
          JSON.stringify(tags),
          JSON.stringify(input.metadata || {}),
          timestamp,
          timestamp,
          input.due_at || null,
          input.estimated_minutes || null,
          input.sla_minutes ?? null,
          input.confidence ?? null,
          input.retry_count ?? 0,
          input.max_retries ?? 3,
          input.retry_after ?? null,
          input.requires_approval ? 1 : 0,
          null,
          null,
          input.recurrence_rule || null,
          input.recurrence_parent_id || null,
          input.spawns_template_id || null,
          input.reason || null,
          input.spawned_from_session || null,
          assignedBy || null,
          assignedFromProject || null,
          input.task_type || null,
          machineId,
        ],
      );
      break; // success
    } catch (e: any) {
      // On PRIMARY KEY collision (nanoid dupe), retry with a new id
      if (attempt < 2 && e?.message?.includes("UNIQUE constraint failed: tasks.id")) {
        id = uuid();
        continue;
      }
      throw e;
    }
  }

  if (tags.length > 0) {
    insertTaskTags(id, tags, d);
  }

  const task = getTask(id, d)!;
  const payload = taskEventData(task);
  const databasePath = databasePathFromDatabase(d);
  dispatchWebhook("task.created", payload, d).catch(() => {});
  emitLocalEventHooksQuiet({ type: "task.created", payload, databasePath });
  emitSharedTaskEventQuiet({ type: "task.created", task, databasePath });
  return task;
}

export function getTask(id: string, db?: Database): Task | null {
  const d = getDatabase(db);
  const row = d.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | null;
  if (!row) return null;
  return rowToTask(row);
}

export function getTaskWithRelations(
  id: string,
  db?: Database,
): TaskWithRelations | null {
  const d = getDatabase(db);
  const task = getTask(id, d);
  if (!task) return null;

  // Get subtasks
  const subtaskRows = d
    .query("SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at")
    .all(id) as TaskRow[];
  const subtasks = subtaskRows.map(rowToTask);

  // Get dependencies (tasks this task depends on)
  const depRows = d
    .query(
      `SELECT t.* FROM tasks t
       JOIN task_dependencies td ON td.depends_on = t.id
       WHERE td.task_id = ?`,
    )
    .all(id) as TaskRow[];
  const dependencies = depRows.map(rowToTask);

  // Get blocked_by (tasks that depend on this task)
  const blockedByRows = d
    .query(
      `SELECT t.* FROM tasks t
       JOIN task_dependencies td ON td.task_id = t.id
       WHERE td.depends_on = ?`,
    )
    .all(id) as TaskRow[];
  const blocked_by = blockedByRows.map(rowToTask);

  // Get comments
  const comments = d
    .query(
      // SQLite rowid is the stable local insertion-order tiebreaker. Apply it
      // before the CLI's newest-100 display bound so equal-clock comments do
      // not drift across repeated show/inspect reads.
      "SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at, rowid",
    )
    .all(id) as TaskWithRelations["comments"];

  // Get parent
  const parent = task.parent_id ? getTask(task.parent_id, d) : null;

  // Get checklist items
  const checklist = getChecklist(id, d);

  return {
    ...task,
    subtasks,
    dependencies,
    blocked_by,
    comments,
    parent,
    checklist,
  };
}

export function listTasks(filter: TaskFilter = {}, db?: Database): Task[] {
  const d = getDatabase(db);
  const { clearExpiredLocks } = require("./database.js");
  clearExpiredLocks(d);
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (filter.project_id) {
    conditions.push("project_id = ?");
    params.push(filter.project_id);
  }

  if (filter.ids && filter.ids.length > 0) {
    conditions.push(`id IN (${filter.ids.map(() => "?").join(",")})`);
    params.push(...filter.ids);
  }

  if (filter.parent_id !== undefined) {
    if (filter.parent_id === null) {
      conditions.push("parent_id IS NULL");
    } else {
      conditions.push("parent_id = ?");
      params.push(filter.parent_id);
    }
  }

  if (filter.status) {
    if (Array.isArray(filter.status)) {
      conditions.push(`status IN (${filter.status.map(() => "?").join(",")})`);
      params.push(...filter.status);
    } else {
      conditions.push("status = ?");
      params.push(filter.status);
    }
  }

  if (filter.priority) {
    if (Array.isArray(filter.priority)) {
      conditions.push(
        `priority IN (${filter.priority.map(() => "?").join(",")})`,
      );
      params.push(...filter.priority);
    } else {
      conditions.push("priority = ?");
      params.push(filter.priority);
    }
  }

  if (filter.assigned_to) {
    conditions.push("assigned_to = ?");
    params.push(filter.assigned_to);
  }

  if (filter.agent_id) {
    conditions.push("agent_id = ?");
    params.push(filter.agent_id);
  }

  if (filter.session_id) {
    conditions.push("session_id = ?");
    params.push(filter.session_id);
  }

  if (filter.tags && filter.tags.length > 0) {
    const placeholders = filter.tags.map(() => "?").join(",");
    conditions.push(`id IN (SELECT task_id FROM task_tags WHERE tag IN (${placeholders}))`);
    params.push(...filter.tags);
  }

  if (filter.plan_id) {
    conditions.push("plan_id = ?");
    params.push(filter.plan_id);
  }

  if (filter.task_list_id) {
    conditions.push("task_list_id = ?");
    params.push(filter.task_list_id);
  }

  if (filter.has_recurrence === true) {
    conditions.push("recurrence_rule IS NOT NULL");
  } else if (filter.has_recurrence === false) {
    conditions.push("recurrence_rule IS NULL");
  }

  if (filter.task_type) {
    if (Array.isArray(filter.task_type)) {
      conditions.push(`task_type IN (${filter.task_type.map(() => "?").join(",")})`);
      params.push(...filter.task_type);
    } else {
      conditions.push("task_type = ?");
      params.push(filter.task_type);
    }
  }

  addMetadataConditions(filter.metadata, conditions, params);

  const PRIORITY_RANK = `CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END`;

  // Cursor-based pagination: decode cursor and add compound WHERE condition
  if (filter.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(filter.cursor, "base64").toString("utf8")) as { p: number; c: string; i: string };
      conditions.push(
        `(${PRIORITY_RANK} > ? OR (${PRIORITY_RANK} = ? AND created_at < ?) OR (${PRIORITY_RANK} = ? AND created_at = ? AND id > ?))`
      );
      params.push(decoded.p, decoded.p, decoded.c, decoded.p, decoded.c, decoded.i);
    } catch {
      // Invalid cursor — ignore and return from beginning
    }
  }

  // Exclude archived tasks by default
  if (!filter.include_archived) {
    conditions.push("archived_at IS NULL");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  let limitClause = "";
  if (filter.limit) {
    limitClause = " LIMIT ?";
    params.push(filter.limit);
    if (!filter.cursor && filter.offset) {
      limitClause += " OFFSET ?";
      params.push(filter.offset);
    }
  }

  const rows = d
    .query(
      `SELECT * FROM tasks ${where} ORDER BY ${PRIORITY_RANK}, created_at DESC, id ASC${limitClause}`,
    )
    .all(...params) as TaskRow[];

  return rows.map(rowToTask);
}

export function getTaskByFingerprint(
  fingerprint: string,
  db?: Database,
): Task | null {
  // M9: include archived tasks so a fingerprint match on an archived task is
  // found — otherwise upsert would create a duplicate.
  const tasks = listTasks({ metadata: { fingerprint }, limit: 1, include_archived: true }, db);
  return tasks[0] ?? null;
}

function mergeTaskMetadata(
  current: Record<string, unknown>,
  next: Record<string, unknown> | undefined,
  fingerprint: string,
): Record<string, unknown> {
  return {
    ...current,
    ...(next ?? {}),
    fingerprint,
  };
}

export function upsertTaskByFingerprint(
  input: UpsertTaskByFingerprintInput,
  db?: Database,
): UpsertTaskByFingerprintResult {
  const d = getDatabase(db);
  const fingerprint = input.fingerprint.trim();
  if (!fingerprint) throw new Error("fingerprint is required");

  // M9: wrap the check-then-create/update in a transaction so two concurrent
  // upserts on the same fingerprint can't both pass the existence check and
  // create duplicates. SQLite serializes writers, so the transaction provides
  // the needed exclusivity on a single database. (A partial unique index on
  // json_extract(metadata,'$.fingerprint') would be the belt-and-braces fix but
  // is unsafe to add retroactively while duplicates may already exist.)
  const tx = d.transaction((): UpsertTaskByFingerprintResult => {
  const existing = getTaskByFingerprint(fingerprint, d);
  const metadata = mergeTaskMetadata(existing?.metadata ?? {}, input.metadata, fingerprint);

  if (!existing) {
    const task = createTask({ ...input, metadata }, d);
    return { task, created: true };
  }

  const task = updateTask(
    existing.id,
    {
      version: existing.version,
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      project_id: input.project_id,
      assigned_to: input.assigned_to,
      working_dir: input.working_dir,
      plan_id: input.plan_id,
      task_list_id: input.task_list_id,
      tags: input.tags,
      metadata,
      due_at: input.due_at,
      estimated_minutes: input.estimated_minutes,
      sla_minutes: input.sla_minutes,
      confidence: input.confidence,
      retry_count: input.retry_count,
      max_retries: input.max_retries,
      retry_after: input.retry_after,
      requires_approval: input.requires_approval,
      recurrence_rule: input.recurrence_rule,
      task_type: input.task_type,
    },
    d,
  );
  return { task, created: false };
  });
  return tx();
}

export function countTasks(filter: Omit<TaskFilter, 'limit' | 'offset'> = {}, db?: Database): number {
  const d = getDatabase(db);
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (filter.project_id) {
    conditions.push("project_id = ?");
    params.push(filter.project_id);
  }

  if (filter.ids && filter.ids.length > 0) {
    conditions.push(`id IN (${filter.ids.map(() => "?").join(",")})`);
    params.push(...filter.ids);
  }

  if (filter.parent_id !== undefined) {
    if (filter.parent_id === null) {
      conditions.push("parent_id IS NULL");
    } else {
      conditions.push("parent_id = ?");
      params.push(filter.parent_id);
    }
  }

  if (filter.status) {
    if (Array.isArray(filter.status)) {
      conditions.push(`status IN (${filter.status.map(() => "?").join(",")})`);
      params.push(...filter.status);
    } else {
      conditions.push("status = ?");
      params.push(filter.status);
    }
  }

  if (filter.priority) {
    if (Array.isArray(filter.priority)) {
      conditions.push(
        `priority IN (${filter.priority.map(() => "?").join(",")})`,
      );
      params.push(...filter.priority);
    } else {
      conditions.push("priority = ?");
      params.push(filter.priority);
    }
  }

  if (filter.assigned_to) {
    conditions.push("assigned_to = ?");
    params.push(filter.assigned_to);
  }

  if (filter.agent_id) {
    conditions.push("agent_id = ?");
    params.push(filter.agent_id);
  }

  if (filter.session_id) {
    conditions.push("session_id = ?");
    params.push(filter.session_id);
  }

  if (filter.tags && filter.tags.length > 0) {
    const placeholders = filter.tags.map(() => "?").join(",");
    conditions.push(`id IN (SELECT task_id FROM task_tags WHERE tag IN (${placeholders}))`);
    params.push(...filter.tags);
  }

  if (filter.plan_id) {
    conditions.push("plan_id = ?");
    params.push(filter.plan_id);
  }

  if (filter.task_list_id) {
    conditions.push("task_list_id = ?");
    params.push(filter.task_list_id);
  }

  // M10: mirror listTasks so counts match the filtered list.
  if (filter.has_recurrence === true) {
    conditions.push("recurrence_rule IS NOT NULL");
  } else if (filter.has_recurrence === false) {
    conditions.push("recurrence_rule IS NULL");
  }

  if (filter.task_type) {
    if (Array.isArray(filter.task_type)) {
      conditions.push(`task_type IN (${filter.task_type.map(() => "?").join(",")})`);
      params.push(...filter.task_type);
    } else {
      conditions.push("task_type = ?");
      params.push(filter.task_type);
    }
  }

  addMetadataConditions(filter.metadata, conditions, params);

  // Exclude archived tasks by default (consistent with listTasks)
  if (!filter.include_archived) {
    conditions.push("archived_at IS NULL");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const row = d.query(`SELECT COUNT(*) as count FROM tasks ${where}`).get(...params) as { count: number };
  return row.count;
}

export function updateTask(
  id: string,
  input: UpdateTaskInput,
  db?: Database,
): Task {
  const d = getDatabase(db);
  const task = getTask(id, d);
  if (!task) throw new TaskNotFoundError(id);

  // Optimistic locking check
  if (task.version !== input.version) {
    throw new VersionConflictError(id, input.version, task.version);
  }

  const timestamp = now();
  const completionTimestamp = input.completed_at ?? timestamp;
  const sets: string[] = ["version = version + 1", "updated_at = ?"];
  const params: SQLQueryBindings[] = [timestamp];

  if (input.title !== undefined) {
    sets.push("title = ?");
    params.push(input.title);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.status !== undefined) {
    // Completion guard when transitioning to completed
    if (input.status === "completed") {
      checkCompletionGuard(task, task.assigned_to || task.agent_id || null, d);
    }
    sets.push("status = ?");
    params.push(input.status);
    if (input.status === "completed") {
      sets.push("completed_at = ?");
      params.push(completionTimestamp);
      // M1: mirror completeTask — completing a task releases its lock so a
      // recurring/handoff chain isn't left holding a stale lock.
      sets.push("locked_by = NULL");
      sets.push("locked_at = NULL");
    } else if (task.status === "completed" && input.completed_at === undefined) {
      // M3: reopening a completed task clears the stale completed_at.
      sets.push("completed_at = NULL");
    }
  }
  if (input.priority !== undefined) {
    sets.push("priority = ?");
    params.push(input.priority);
  }
  if (input.project_id !== undefined) {
    sets.push("project_id = ?");
    params.push(input.project_id);
  }
  if (input.assigned_to !== undefined) {
    sets.push("assigned_to = ?");
    params.push(input.assigned_to);
  }
  if (input.working_dir !== undefined) {
    sets.push("working_dir = ?");
    params.push(input.working_dir);
  }
  if (input.tags !== undefined) {
    sets.push("tags = ?");
    params.push(JSON.stringify(input.tags));
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }
  if (input.plan_id !== undefined) {
    sets.push("plan_id = ?");
    params.push(input.plan_id);
  }
  if (input.task_list_id !== undefined) {
    sets.push("task_list_id = ?");
    params.push(input.task_list_id);
  }
  if (input.due_at !== undefined) {
    sets.push("due_at = ?");
    params.push(input.due_at);
  }
  if (input.estimated_minutes !== undefined) {
    sets.push("estimated_minutes = ?");
    params.push(input.estimated_minutes);
  }
  if (input.sla_minutes !== undefined) {
    sets.push("sla_minutes = ?");
    params.push(input.sla_minutes);
  }
  if (input.actual_minutes !== undefined) {
    sets.push("actual_minutes = ?");
    params.push(input.actual_minutes);
  }
  if (input.completed_at !== undefined && input.status !== "completed") {
    sets.push("completed_at = ?");
    params.push(input.completed_at);
  }
  if (input.confidence !== undefined) {
    sets.push("confidence = ?");
    params.push(input.confidence);
  }
  if (input.retry_count !== undefined) {
    sets.push("retry_count = ?");
    params.push(input.retry_count);
  }
  if (input.max_retries !== undefined) {
    sets.push("max_retries = ?");
    params.push(input.max_retries);
  }
  if (input.retry_after !== undefined) {
    sets.push("retry_after = ?");
    params.push(input.retry_after);
  }
  if (input.requires_approval !== undefined) {
    sets.push("requires_approval = ?");
    params.push(input.requires_approval ? 1 : 0);
  }
  if (input.approved_by !== undefined) {
    sets.push("approved_by = ?");
    params.push(input.approved_by);
    sets.push("approved_at = ?");
    params.push(now());
  }
  if (input.recurrence_rule !== undefined) {
    sets.push("recurrence_rule = ?");
    params.push(input.recurrence_rule);
  }
  if (input.task_type !== undefined) {
    sets.push("task_type = ?");
    params.push(input.task_type ?? null);
  }

  params.push(id, input.version);

  const result = d.run(
    `UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND version = ?`,
    params,
  );

  if (result.changes === 0) {
    const current = getTask(id, d);
    throw new VersionConflictError(
      id,
      input.version,
      current?.version ?? -1,
    );
  }

  if (input.tags !== undefined) {
    replaceTaskTags(id, input.tags, d);
  }

  // M1: the generic update path is what the dashboard PATCH (routes.ts) and the
  // CLI `update --status completed` actually call — completeTask is NOT involved
  // here. Without this, completing a recurring task via update stamped
  // completed_at but never continued the chain, so recurring tasks silently died.
  //
  // Single-spawn reasoning: this fires ONLY on a transition INTO "completed"
  // from a non-completed status, so re-saving an already-completed task does not
  // re-spawn (idempotent). completeTask spawns for its own callers and never
  // routes through updateTask; setTaskStatus routes the completed case to
  // completeTask (bypassing updateTask). Therefore each completion path has
  // exactly one spawner and no path runs both.
  const transitionedToCompleted = input.status === "completed" && task.status !== "completed";
  if (transitionedToCompleted && task.recurrence_rule) {
    try {
      // Inline require avoids a static circular import (task-lifecycle imports
      // createTask/getTask from this module); matches the existing house style
      // used for database.js in listTasks.
      const { spawnNextRecurrence } = require("./task-lifecycle.js") as typeof import("./task-lifecycle.js");
      spawnNextRecurrence(task, d, completionTimestamp);
    } catch (e) {
      // Defensive: a malformed recurrence_rule makes nextOccurrence throw AFTER
      // the status is already committed. Log and skip rather than surfacing a
      // post-commit error to the caller.
      console.warn(`[tasks] failed to spawn next recurrence for ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Audit log — record each changed field
  const agentId = task.assigned_to || task.agent_id || null;
  if (input.status !== undefined && input.status !== task.status) logTaskChange(id, "update", "status", task.status, input.status, agentId, d);
  if (input.priority !== undefined && input.priority !== task.priority) logTaskChange(id, "update", "priority", task.priority, input.priority, agentId, d);
  if (input.title !== undefined && input.title !== task.title) logTaskChange(id, "update", "title", task.title, input.title, agentId, d);
  if (input.assigned_to !== undefined && input.assigned_to !== task.assigned_to) logTaskChange(id, "update", "assigned_to", task.assigned_to, input.assigned_to, agentId, d);
  if (input.working_dir !== undefined && input.working_dir !== task.working_dir) logTaskChange(id, "update", "working_dir", task.working_dir, input.working_dir, agentId, d);
  if (input.approved_by !== undefined) logTaskChange(id, "approve", "approved_by", null, input.approved_by, agentId, d);

  // Determine the post-write completion timestamp / lock state to mirror the SQL above.
  const reopened = input.status !== undefined && input.status !== "completed" && task.status === "completed" && input.completed_at === undefined;
  const completedNow = input.status === "completed";
  const updatedTask: Task = {
    ...task,
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    tags: input.tags ?? task.tags,
    metadata: input.metadata ?? task.metadata,
    version: task.version + 1,
    updated_at: timestamp,
    locked_by: completedNow ? null : task.locked_by,
    locked_at: completedNow ? null : task.locked_at,
    completed_at: completedNow ? completionTimestamp : reopened ? null : input.completed_at !== undefined ? input.completed_at : task.completed_at,
    sla_minutes: input.sla_minutes !== undefined ? input.sla_minutes : task.sla_minutes,
    actual_minutes: input.actual_minutes ?? task.actual_minutes,
    confidence: input.confidence !== undefined ? input.confidence : task.confidence,
    retry_count: input.retry_count ?? task.retry_count,
    max_retries: input.max_retries ?? task.max_retries,
    retry_after: input.retry_after !== undefined ? input.retry_after : task.retry_after,
    requires_approval: input.requires_approval !== undefined ? input.requires_approval : task.requires_approval,
    approved_by: input.approved_by ?? task.approved_by,
    approved_at: input.approved_by ? timestamp : task.approved_at,
  };

  // Webhook dispatch for assignment and status changes
  const databasePath = databasePathFromDatabase(d);
  if (input.assigned_to !== undefined && input.assigned_to !== task.assigned_to) {
    const payload = taskEventData(updatedTask, { assigned_to: input.assigned_to, old_assigned_to: task.assigned_to });
    dispatchWebhook("task.assigned", payload, d).catch(() => {});
    emitLocalEventHooksQuiet({ type: "task.assigned", payload, databasePath });
    emitSharedTaskEventQuiet({ type: "task.assigned", task: updatedTask, data: { old_assigned_to: task.assigned_to }, databasePath });
  }
  if (input.status !== undefined && input.status !== task.status) {
    const payload = taskEventData(updatedTask, { old_status: task.status, new_status: input.status });
    dispatchWebhook("task.status_changed", payload, d).catch(() => {});
    emitLocalEventHooksQuiet({ type: "task.status_changed", payload, databasePath });
    emitSharedTaskEventQuiet({ type: "task.status_changed", task: updatedTask, data: { old_status: task.status, new_status: input.status }, databasePath });
  }
  if (input.approved_by !== undefined) {
    emitLocalEventHooksQuiet({ type: "approval.decided", payload: { id, approved_by: input.approved_by, title: task.title }, databasePath });
  }

  const updatePayload = taskEventData(updatedTask);
  dispatchWebhook("task.updated", updatePayload, d).catch(() => {});
  emitLocalEventHooksQuiet({ type: "task.updated", payload: updatePayload, databasePath });
  emitSharedTaskEventQuiet({ type: "task.updated", task: updatedTask, databasePath });

  // Return updated task without re-fetching from DB
  return updatedTask;
}

export function deleteTask(id: string, db?: Database): boolean {
  const d = getDatabase(db);
  const row = d.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | null;
  if (!row) return false;
  recordStorageTombstone({
    object_type: "tasks",
    object_id: id,
    payload: rowToTask(row) as unknown as Record<string, unknown>,
    version: row.version,
  }, d);
  const result = d.run("DELETE FROM tasks WHERE id = ?", [id]);
  return result.changes > 0;
}
