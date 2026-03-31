import type { Database, SQLQueryBindings } from "bun:sqlite";
import type {
  CreateTaskInput,
  LockResult,
  Task,
  TaskDependency,
  TaskFilter,
  TaskPriority,
  TaskRow,
  TaskStatus,
  TaskWithRelations,
  UpdateTaskInput,
} from "../types/index.js";
import {
  DependencyCycleError,
  LockError,
  TaskNotFoundError,
  VersionConflictError,
} from "../types/index.js";
import { clearExpiredLocks, getDatabase, isLockExpired, lockExpiryCutoff, now, uuid } from "./database.js";
import { nextTaskShortId } from "./projects.js";
import { checkCompletionGuard } from "../lib/completion-guard.js";
import { logTaskChange } from "./audit.js";
import { nextOccurrence } from "../lib/recurrence.js";
import { dispatchWebhook } from "./webhooks.js";
import { taskFromTemplate } from "./templates.js";
import { getChecklist } from "./checklists.js";

function rowToTask(row: TaskRow): Task {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]") as string[],
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
    status: row.status as Task["status"],
    priority: row.priority as Task["priority"],
    requires_approval: !!row.requires_approval,
  };
}

function insertTaskTags(taskId: string, tags: string[], db: Database): void {
  if (tags.length === 0) return;
  const stmt = db.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)");
  for (const tag of tags) {
    if (tag) stmt.run(taskId, tag);
  }
}

function replaceTaskTags(taskId: string, tags: string[], db: Database): void {
  db.run("DELETE FROM task_tags WHERE task_id = ?", [taskId]);
  insertTaskTags(taskId, tags, db);
}

export function createTask(input: CreateTaskInput, db?: Database): Task {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  const tags = input.tags || [];

  // Generate short_id from project prefix if project has one
  const shortId = input.project_id ? nextTaskShortId(input.project_id, d) : null;

  // Prepend short_id to title if generated
  const title = shortId ? `${shortId}: ${input.title}` : input.title;

  // assigned_by = who created this task (always the calling agent)
  // assigned_from_project = which project they were in when they assigned it
  const assignedBy = input.assigned_by || input.agent_id;
  const assignedFromProject = input.assigned_from_project || null;

  d.run(
    `INSERT INTO tasks (id, short_id, project_id, parent_id, plan_id, task_list_id, title, description, status, priority, agent_id, assigned_to, session_id, working_dir, tags, metadata, version, created_at, updated_at, due_at, estimated_minutes, requires_approval, approved_by, approved_at, recurrence_rule, recurrence_parent_id, spawns_template_id, reason, spawned_from_session, assigned_by, assigned_from_project, task_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      shortId,
      input.project_id || null,
      input.parent_id || null,
      input.plan_id || null,
      input.task_list_id || null,
      title,
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
    ],
  );

  if (tags.length > 0) {
    insertTaskTags(id, tags, d);
  }

  const task = getTask(id, d)!;
  dispatchWebhook("task.created", { id: task.id, short_id: task.short_id, title: task.title, status: task.status, priority: task.priority, project_id: task.project_id, assigned_to: task.assigned_to }, d).catch(() => {});
  return task;
}

export function getTask(id: string, db?: Database): Task | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | null;
  if (!row) return null;
  return rowToTask(row);
}

export function getTaskWithRelations(
  id: string,
  db?: Database,
): TaskWithRelations | null {
  const d = db || getDatabase();
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
      "SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at",
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
  const d = db || getDatabase();
  clearExpiredLocks(d);
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (filter.project_id) {
    conditions.push("project_id = ?");
    params.push(filter.project_id);
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
      `SELECT * FROM tasks ${where} ORDER BY ${PRIORITY_RANK}, created_at DESC${limitClause}`,
    )
    .all(...params) as TaskRow[];

  return rows.map(rowToTask);
}

export function countTasks(filter: Omit<TaskFilter, 'limit' | 'offset'> = {}, db?: Database): number {
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (filter.project_id) {
    conditions.push("project_id = ?");
    params.push(filter.project_id);
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

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const row = d.query(`SELECT COUNT(*) as count FROM tasks ${where}`).get(...params) as { count: number };
  return row.count;
}

export function updateTask(
  id: string,
  input: UpdateTaskInput,
  db?: Database,
): Task {
  const d = db || getDatabase();
  const task = getTask(id, d);
  if (!task) throw new TaskNotFoundError(id);

  // Optimistic locking check
  if (task.version !== input.version) {
    throw new VersionConflictError(id, input.version, task.version);
  }

  const sets: string[] = ["version = version + 1", "updated_at = ?"];
  const params: SQLQueryBindings[] = [now()];

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
      params.push(now());
    }
  }
  if (input.priority !== undefined) {
    sets.push("priority = ?");
    params.push(input.priority);
  }
  if (input.assigned_to !== undefined) {
    sets.push("assigned_to = ?");
    params.push(input.assigned_to);
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

  // Audit log — record each changed field
  const agentId = task.assigned_to || task.agent_id || null;
  if (input.status !== undefined && input.status !== task.status) logTaskChange(id, "update", "status", task.status, input.status, agentId, d);
  if (input.priority !== undefined && input.priority !== task.priority) logTaskChange(id, "update", "priority", task.priority, input.priority, agentId, d);
  if (input.title !== undefined && input.title !== task.title) logTaskChange(id, "update", "title", task.title, input.title, agentId, d);
  if (input.assigned_to !== undefined && input.assigned_to !== task.assigned_to) logTaskChange(id, "update", "assigned_to", task.assigned_to, input.assigned_to, agentId, d);
  if (input.approved_by !== undefined) logTaskChange(id, "approve", "approved_by", null, input.approved_by, agentId, d);

  // Webhook dispatch for assignment and status changes
  if (input.assigned_to !== undefined && input.assigned_to !== task.assigned_to) {
    dispatchWebhook("task.assigned", { id, assigned_to: input.assigned_to, title: task.title }, d).catch(() => {});
  }
  if (input.status !== undefined && input.status !== task.status) {
    dispatchWebhook("task.status_changed", { id, old_status: task.status, new_status: input.status, title: task.title }, d).catch(() => {});
  }

  // Return updated task without re-fetching from DB
  return {
    ...task,
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    tags: input.tags ?? task.tags,
    metadata: input.metadata ?? task.metadata,
    version: task.version + 1,
    updated_at: now(),
    completed_at: input.status === "completed" ? now() : task.completed_at,
    requires_approval: input.requires_approval !== undefined ? input.requires_approval : task.requires_approval,
    approved_by: input.approved_by ?? task.approved_by,
    approved_at: input.approved_by ? now() : task.approved_at,
  };
}

export function deleteTask(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM tasks WHERE id = ?", [id]);
  return result.changes > 0;
}

export function getBlockingDeps(id: string, db?: Database): Task[] {
  const d = db || getDatabase();
  const deps = getTaskDependencies(id, d);
  if (deps.length === 0) return [];
  const blocking: Task[] = [];
  for (const dep of deps) {
    const task = getTask(dep.depends_on, d);
    if (task && task.status !== "completed") blocking.push(task);
  }
  return blocking;
}

export function startTask(
  id: string,
  agentId: string,
  db?: Database,
): Task {
  const d = db || getDatabase();
  const task = getTask(id, d);
  if (!task) throw new TaskNotFoundError(id);

  // Check blocking dependencies
  const blocking = getBlockingDeps(id, d);
  if (blocking.length > 0) {
    const blockerIds = blocking.map(b => b.id.slice(0, 8)).join(", ");
    throw new Error(`Task is blocked by ${blocking.length} unfinished dependency(ies): ${blockerIds}`);
  }

  const cutoff = lockExpiryCutoff();
  const timestamp = now();
  const result = d.run(
    `UPDATE tasks SET status = 'in_progress', assigned_to = ?, locked_by = ?, locked_at = ?, started_at = COALESCE(started_at, ?), version = version + 1, updated_at = ?
     WHERE id = ? AND (locked_by IS NULL OR locked_by = ? OR locked_at < ?)`,
    [agentId, agentId, timestamp, timestamp, timestamp, id, agentId, cutoff],
  );

  if (result.changes === 0) {
    if (task.locked_by && task.locked_by !== agentId && !isLockExpired(task.locked_at)) {
      throw new LockError(id, task.locked_by);
    }
  }

  logTaskChange(id, "start", "status", "pending", "in_progress", agentId, d);
  dispatchWebhook("task.started", { id, agent_id: agentId, title: task.title }, d).catch(() => {});

  // Return constructed result — no re-fetch
  return { ...task, status: "in_progress" as const, assigned_to: agentId, locked_by: agentId, locked_at: timestamp, started_at: task.started_at || timestamp, version: task.version + 1, updated_at: timestamp };
}

export function completeTask(
  id: string,
  agentId?: string,
  db?: Database,
  options?: { files_changed?: string[]; test_results?: string; commit_hash?: string; notes?: string; attachment_ids?: string[]; skip_recurrence?: boolean; confidence?: number },
): Task {
  const d = db || getDatabase();
  const task = getTask(id, d);
  if (!task) throw new TaskNotFoundError(id);

  // Check lock ownership if agent specified
  if (
    agentId &&
    task.locked_by &&
    task.locked_by !== agentId &&
    !isLockExpired(task.locked_at)
  ) {
    throw new LockError(id, task.locked_by);
  }

  // Completion guard: rate limit, min work time, cooldown
  checkCompletionGuard(task, agentId || null, d);

  // Extract evidence fields (everything except skip_recurrence and confidence)
  const evidence = options ? { files_changed: options.files_changed, test_results: options.test_results, commit_hash: options.commit_hash, notes: options.notes, attachment_ids: options.attachment_ids } : undefined;
  const hasEvidence = evidence && (evidence.files_changed || evidence.test_results || evidence.commit_hash || evidence.notes || evidence.attachment_ids);

  // Build completion metadata (evidence + confidence)
  const completionMeta: Record<string, unknown> = {};
  if (hasEvidence) completionMeta._evidence = evidence;
  if (options?.confidence !== undefined) {
    completionMeta._completion = { confidence: options.confidence };
  }
  const hasMeta = Object.keys(completionMeta).length > 0;
  if (hasMeta) {
    const meta = { ...task.metadata, ...completionMeta };
    d.run("UPDATE tasks SET metadata = ? WHERE id = ?", [JSON.stringify(meta), id]);
  }

  const timestamp = now();
  const confidence = options?.confidence !== undefined ? options.confidence : null;
  d.run(
    `UPDATE tasks SET status = 'completed', locked_by = NULL, locked_at = NULL, completed_at = ?, confidence = ?, version = version + 1, updated_at = ?
     WHERE id = ?`,
    [timestamp, confidence, timestamp, id],
  );

  logTaskChange(id, "complete", "status", task.status, "completed", agentId || null, d);
  dispatchWebhook("task.completed", { id, agent_id: agentId, title: task.title, completed_at: timestamp }, d).catch(() => {});

  // Auto-spawn next recurring task
  let spawnedTask: Task | null = null;
  if (task.recurrence_rule && !options?.skip_recurrence) {
    spawnedTask = spawnNextRecurrence(task, d);
  }

  // Auto-spawn next task from template (pipeline/handoff chains)
  let spawnedFromTemplate: Task | null = null;
  if (task.spawns_template_id) {
    try {
      const input = taskFromTemplate(task.spawns_template_id, {
        project_id: task.project_id ?? undefined,
        plan_id: task.plan_id ?? undefined,
        task_list_id: task.task_list_id ?? undefined,
        assigned_to: task.assigned_to ?? undefined,
      }, d);
      spawnedFromTemplate = createTask(input, d);
    } catch {
      // Template may have been deleted; skip silently
    }
  }

  // Return constructed result — no re-fetch
  const meta = hasMeta ? { ...task.metadata, ...completionMeta } : task.metadata;
  if (spawnedTask) {
    (meta as Record<string, unknown>)._next_recurrence = { id: spawnedTask.id, short_id: spawnedTask.short_id, due_at: spawnedTask.due_at };
  }
  if (spawnedFromTemplate) {
    (meta as Record<string, unknown>)._spawned_task = { id: spawnedFromTemplate.id, short_id: spawnedFromTemplate.short_id, title: spawnedFromTemplate.title };
  }

  // Check for newly unblocked dependents
  const unblockedDeps = d.query(
    `SELECT DISTINCT t.id, t.short_id, t.title FROM tasks t
     JOIN task_dependencies td ON td.task_id = t.id
     WHERE td.depends_on = ? AND t.status = 'pending'
     AND NOT EXISTS (
       SELECT 1 FROM task_dependencies td2
       JOIN tasks dep2 ON dep2.id = td2.depends_on
       WHERE td2.task_id = t.id AND dep2.status NOT IN ('completed', 'cancelled') AND dep2.id != ?
     )`
  ).all(id, id) as { id: string; short_id: string | null; title: string }[];

  if (unblockedDeps.length > 0) {
    (meta as Record<string, unknown>)._unblocked = unblockedDeps.map(d => ({ id: d.id, short_id: d.short_id, title: d.title }));
    for (const dep of unblockedDeps) {
      dispatchWebhook("task.unblocked", { id: dep.id, unblocked_by: id, title: dep.title }, d).catch(() => {});
    }
  }

  return { ...task, status: "completed" as const, locked_by: null, locked_at: null, completed_at: timestamp, confidence, version: task.version + 1, updated_at: timestamp, metadata: meta };
}

export function lockTask(
  id: string,
  agentId: string,
  db?: Database,
): LockResult {
  const d = db || getDatabase();
  const task = getTask(id, d);
  if (!task) throw new TaskNotFoundError(id);

  // Already locked by same agent
  if (task.locked_by === agentId && !isLockExpired(task.locked_at)) {
    return { success: true, locked_by: agentId, locked_at: task.locked_at! };
  }

  // Acquire lock (atomically if not locked or expired)
  const cutoff = lockExpiryCutoff();
  const timestamp = now();
  const result = d.run(
    `UPDATE tasks SET locked_by = ?, locked_at = ?, version = version + 1, updated_at = ?
     WHERE id = ? AND (locked_by IS NULL OR locked_by = ? OR locked_at < ?)`,
    [agentId, timestamp, timestamp, id, agentId, cutoff],
  );

  if (result.changes === 0) {
    const current = getTask(id, d);
    if (!current) throw new TaskNotFoundError(id);
    if (current.locked_by && !isLockExpired(current.locked_at)) {
      return {
        success: false,
        locked_by: current.locked_by,
        locked_at: current.locked_at!,
        error: `Task is locked by ${current.locked_by}`,
      };
    }
  }

  return { success: true, locked_by: agentId, locked_at: timestamp };
}

export function unlockTask(
  id: string,
  agentId?: string,
  db?: Database,
): boolean {
  const d = db || getDatabase();
  const task = getTask(id, d);
  if (!task) throw new TaskNotFoundError(id);

  // Only unlock if same agent or force (no agentId)
  if (agentId && task.locked_by && task.locked_by !== agentId) {
    throw new LockError(id, task.locked_by);
  }

  const timestamp = now();
  d.run(
    `UPDATE tasks SET locked_by = NULL, locked_at = NULL, version = version + 1, updated_at = ?
     WHERE id = ?`,
    [timestamp, id],
  );

  return true;
}

// Dependencies

export function addDependency(
  taskId: string,
  dependsOn: string,
  db?: Database,
): void {
  const d = db || getDatabase();

  // Verify both tasks exist
  if (!getTask(taskId, d)) throw new TaskNotFoundError(taskId);
  if (!getTask(dependsOn, d)) throw new TaskNotFoundError(dependsOn);

  // Check for cycles using BFS
  if (wouldCreateCycle(taskId, dependsOn, d)) {
    throw new DependencyCycleError(taskId, dependsOn);
  }

  d.run(
    "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on) VALUES (?, ?)",
    [taskId, dependsOn],
  );
}

export function removeDependency(
  taskId: string,
  dependsOn: string,
  db?: Database,
): boolean {
  const d = db || getDatabase();
  const result = d.run(
    "DELETE FROM task_dependencies WHERE task_id = ? AND depends_on = ?",
    [taskId, dependsOn],
  );
  return result.changes > 0;
}

export function getTaskDependencies(
  taskId: string,
  db?: Database,
): TaskDependency[] {
  const d = db || getDatabase();
  return d
    .query("SELECT * FROM task_dependencies WHERE task_id = ?")
    .all(taskId) as TaskDependency[];
}

export function getTaskDependents(
  taskId: string,
  db?: Database,
): TaskDependency[] {
  const d = db || getDatabase();
  return d
    .query("SELECT * FROM task_dependencies WHERE depends_on = ?")
    .all(taskId) as TaskDependency[];
}

export function cloneTask(
  taskId: string,
  overrides?: Partial<CreateTaskInput>,
  db?: Database,
): Task {
  const d = db || getDatabase();
  const source = getTask(taskId, d);
  if (!source) throw new TaskNotFoundError(taskId);

  const input: CreateTaskInput = {
    title: overrides?.title ?? source.title,
    description: overrides?.description ?? source.description ?? undefined,
    priority: overrides?.priority ?? source.priority,
    project_id: overrides?.project_id ?? source.project_id ?? undefined,
    parent_id: overrides?.parent_id ?? source.parent_id ?? undefined,
    plan_id: overrides?.plan_id ?? source.plan_id ?? undefined,
    task_list_id: overrides?.task_list_id ?? source.task_list_id ?? undefined,
    status: overrides?.status ?? "pending",
    agent_id: overrides?.agent_id ?? source.agent_id ?? undefined,
    assigned_to: overrides?.assigned_to ?? source.assigned_to ?? undefined,
    tags: overrides?.tags ?? source.tags,
    metadata: overrides?.metadata ?? source.metadata,
    estimated_minutes: overrides?.estimated_minutes ?? source.estimated_minutes ?? undefined,
    recurrence_rule: overrides?.recurrence_rule ?? source.recurrence_rule ?? undefined,
  };

  return createTask(input, d);
}

// Task Graph

export interface TaskGraphNode {
  id: string;
  short_id: string | null;
  title: string;
  status: string;
  priority: string;
  is_blocked: boolean;
}

export interface TaskGraph {
  task: TaskGraphNode;
  depends_on: TaskGraph[];
  blocks: TaskGraph[];
}

export function getTaskGraph(
  taskId: string,
  direction: "up" | "down" | "both" = "both",
  db?: Database,
): TaskGraph {
  const d = db || getDatabase();
  const task = getTask(taskId, d);
  if (!task) throw new TaskNotFoundError(taskId);

  function toNode(t: Task): TaskGraphNode {
    const deps = getTaskDependencies(t.id, d);
    const hasUnfinishedDeps = deps.some(dep => {
      const depTask = getTask(dep.depends_on, d);
      return depTask && depTask.status !== "completed";
    });
    return { id: t.id, short_id: t.short_id, title: t.title, status: t.status, priority: t.priority, is_blocked: hasUnfinishedDeps };
  }

  function buildUp(id: string, visited: Set<string>): TaskGraph[] {
    if (visited.has(id)) return [];
    visited.add(id);
    const deps = d.query("SELECT depends_on FROM task_dependencies WHERE task_id = ?").all(id) as { depends_on: string }[];
    return deps.map(dep => {
      const depTask = getTask(dep.depends_on, d);
      if (!depTask) return null;
      return { task: toNode(depTask), depends_on: buildUp(dep.depends_on, visited), blocks: [] };
    }).filter(Boolean) as TaskGraph[];
  }

  function buildDown(id: string, visited: Set<string>): TaskGraph[] {
    if (visited.has(id)) return [];
    visited.add(id);
    const dependents = d.query("SELECT task_id FROM task_dependencies WHERE depends_on = ?").all(id) as { task_id: string }[];
    return dependents.map(dep => {
      const depTask = getTask(dep.task_id, d);
      if (!depTask) return null;
      return { task: toNode(depTask), depends_on: [], blocks: buildDown(dep.task_id, visited) };
    }).filter(Boolean) as TaskGraph[];
  }

  const rootNode = toNode(task);
  const depends_on = (direction === "up" || direction === "both") ? buildUp(taskId, new Set()) : [];
  const blocks = (direction === "down" || direction === "both") ? buildDown(taskId, new Set()) : [];

  return { task: rootNode, depends_on, blocks };
}

export function moveTask(
  taskId: string,
  target: { task_list_id?: string | null; project_id?: string | null; plan_id?: string | null },
  db?: Database,
): Task {
  const d = db || getDatabase();
  const task = getTask(taskId, d);
  if (!task) throw new TaskNotFoundError(taskId);

  const sets: string[] = ["updated_at = ?", "version = version + 1"];
  const params: SQLQueryBindings[] = [now()];

  if (target.task_list_id !== undefined) {
    sets.push("task_list_id = ?");
    params.push(target.task_list_id);
  }
  if (target.project_id !== undefined) {
    sets.push("project_id = ?");
    params.push(target.project_id);
  }
  if (target.plan_id !== undefined) {
    sets.push("plan_id = ?");
    params.push(target.plan_id);
  }

  params.push(taskId);
  d.run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, params);

  return getTask(taskId, d)!;
}

function spawnNextRecurrence(completedTask: Task, db: Database): Task {
  const dueAt = nextOccurrence(completedTask.recurrence_rule!, new Date());

  // Strip short_id prefix from title if present
  let title = completedTask.title;
  if (completedTask.short_id && title.startsWith(completedTask.short_id + ": ")) {
    title = title.slice(completedTask.short_id.length + 2);
  }

  // The recurrence_parent_id chains back to the original recurring task
  const recurrenceParentId = completedTask.recurrence_parent_id || completedTask.id;

  return createTask({
    title,
    description: completedTask.description ?? undefined,
    priority: completedTask.priority,
    project_id: completedTask.project_id ?? undefined,
    task_list_id: completedTask.task_list_id ?? undefined,
    plan_id: completedTask.plan_id ?? undefined,
    assigned_to: completedTask.assigned_to ?? undefined,
    tags: completedTask.tags,
    metadata: completedTask.metadata,
    estimated_minutes: completedTask.estimated_minutes ?? undefined,
    recurrence_rule: completedTask.recurrence_rule!,
    recurrence_parent_id: recurrenceParentId,
    due_at: dueAt,
  }, db);
}

export function claimNextTask(
  agentId: string,
  filters?: { project_id?: string; task_list_id?: string; plan_id?: string; tags?: string[] },
  db?: Database,
): Task | null {
  const d = db || getDatabase();

  // Transaction: find next task + start it atomically
  const tx = d.transaction(() => {
    const task = getNextTask(agentId, filters, d);
    if (!task) return null;
    return startTask(task.id, agentId, d);
  });

  return tx();
}

export function getNextTask(
  agentId?: string,
  filters?: { project_id?: string; task_list_id?: string; plan_id?: string; tags?: string[] },
  db?: Database,
): Task | null {
  const d = db || getDatabase();
  clearExpiredLocks(d);

  const conditions: string[] = ["status = 'pending'", "(locked_by IS NULL OR locked_at < ?)"];
  const params: SQLQueryBindings[] = [lockExpiryCutoff()];

  if (filters?.project_id) { conditions.push("project_id = ?"); params.push(filters.project_id); }
  if (filters?.task_list_id) { conditions.push("task_list_id = ?"); params.push(filters.task_list_id); }
  if (filters?.plan_id) { conditions.push("plan_id = ?"); params.push(filters.plan_id); }
  if (filters?.tags && filters.tags.length > 0) {
    const placeholders = filters.tags.map(() => "?").join(",");
    conditions.push(`id IN (SELECT task_id FROM task_tags WHERE tag IN (${placeholders}))`);
    params.push(...filters.tags);
  }

  // Exclude blocked tasks (those with incomplete dependencies)
  conditions.push("id NOT IN (SELECT td.task_id FROM task_dependencies td JOIN tasks dep ON dep.id = td.depends_on WHERE dep.status != 'completed')");

  const where = conditions.join(" AND ");

  // Agent affinity: boost tasks in projects where agent recently completed work
  let recentProjectIds: string[] = [];
  if (agentId) {
    const recentRows = d.query(
      `SELECT DISTINCT project_id FROM tasks WHERE assigned_to = ? AND status = 'completed' AND project_id IS NOT NULL ORDER BY completed_at DESC LIMIT 3`
    ).all(agentId) as { project_id: string }[];
    recentProjectIds = recentRows.map(r => r.project_id);
  }

  let sql = `SELECT * FROM tasks WHERE ${where} ORDER BY `;
  if (agentId) {
    sql += `CASE WHEN assigned_to = ? THEN 0 WHEN assigned_to IS NULL THEN 1 ELSE 2 END, `;
    params.push(agentId);
  }
  if (recentProjectIds.length > 0) {
    const placeholders = recentProjectIds.map(() => "?").join(",");
    sql += `CASE WHEN project_id IN (${placeholders}) THEN 0 ELSE 1 END, `;
    params.push(...recentProjectIds);
  }
  sql += `CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, created_at ASC LIMIT 1`;

  const row = d.query(sql).get(...params) as TaskRow | null;
  return row ? rowToTask(row) : null;
}

export interface ActiveWorkItem {
  id: string;
  short_id: string | null;
  title: string;
  priority: string;
  assigned_to: string | null;
  locked_by: string | null;
  locked_at: string | null;
  updated_at: string;
}

export function getActiveWork(
  filters?: { project_id?: string; task_list_id?: string },
  db?: Database,
): ActiveWorkItem[] {
  const d = db || getDatabase();
  clearExpiredLocks(d);
  const conditions: string[] = ["status = 'in_progress'"];
  const params: SQLQueryBindings[] = [];

  if (filters?.project_id) { conditions.push("project_id = ?"); params.push(filters.project_id); }
  if (filters?.task_list_id) { conditions.push("task_list_id = ?"); params.push(filters.task_list_id); }

  const where = conditions.join(" AND ");
  const rows = d.query(
    `SELECT id, short_id, title, priority, assigned_to, locked_by, locked_at, updated_at FROM tasks WHERE ${where} ORDER BY
    CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
    updated_at DESC`
  ).all(...params) as ActiveWorkItem[];

  return rows;
}

export function getTasksChangedSince(
  since: string,
  filters?: { project_id?: string; task_list_id?: string },
  db?: Database,
): Task[] {
  const d = db || getDatabase();
  const conditions: string[] = ["updated_at > ?"];
  const params: SQLQueryBindings[] = [since];

  if (filters?.project_id) { conditions.push("project_id = ?"); params.push(filters.project_id); }
  if (filters?.task_list_id) { conditions.push("task_list_id = ?"); params.push(filters.task_list_id); }

  const where = conditions.join(" AND ");
  const rows = d.query(`SELECT * FROM tasks WHERE ${where} ORDER BY updated_at DESC`).all(...params) as TaskRow[];
  return rows.map(rowToTask);
}

export function failTask(
  id: string,
  agentId?: string,
  reason?: string,
  options?: { retry?: boolean; retry_after?: string; error_code?: string },
  db?: Database,
): { task: Task; retryTask?: Task } {
  const d = db || getDatabase();
  const task = getTask(id, d);
  if (!task) throw new TaskNotFoundError(id);

  // Store failure info in metadata
  const meta: Record<string, unknown> = {
    ...task.metadata,
    _failure: {
      reason: reason || "Unknown failure",
      error_code: options?.error_code || null,
      failed_by: agentId || null,
      failed_at: now(),
      retry_requested: options?.retry || false,
    },
  };

  const timestamp = now();
  d.run(
    `UPDATE tasks SET status = 'failed', locked_by = NULL, locked_at = NULL, metadata = ?, version = version + 1, updated_at = ?
     WHERE id = ?`,
    [JSON.stringify(meta), timestamp, id],
  );

  logTaskChange(id, "fail", "status", task.status, "failed", agentId || null, d);
  dispatchWebhook("task.failed", { id, reason, error_code: options?.error_code, agent_id: agentId, title: task.title }, d).catch(() => {});

  const failedTask: Task = {
    ...task,
    status: "failed" as const,
    locked_by: null,
    locked_at: null,
    metadata: meta,
    version: task.version + 1,
    updated_at: timestamp,
  };

  // Auto-retry: create a new pending copy with exponential backoff
  let retryTask: Task | undefined;
  if (options?.retry) {
    const retryCount = (task.retry_count || 0) + 1;
    const maxRetries = task.max_retries || 3;

    if (retryCount > maxRetries) {
      // Exceeded max retries — don't create retry copy, add to metadata
      d.run("UPDATE tasks SET metadata = ? WHERE id = ?", [
        JSON.stringify({ ...meta, _retry_exhausted: { retry_count: retryCount - 1, max_retries: maxRetries } }),
        id,
      ]);
    } else {
      // Exponential backoff: 1min, 5min, 25min, 125min...
      const backoffMinutes = Math.pow(5, retryCount - 1);
      const retryAfter = options.retry_after || new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

      // Strip short_id prefix from title
      let title = task.title;
      if (task.short_id && title.startsWith(task.short_id + ": ")) {
        title = title.slice(task.short_id.length + 2);
      }

      retryTask = createTask({
        title,
        description: task.description ?? undefined,
        priority: task.priority,
        project_id: task.project_id ?? undefined,
        task_list_id: task.task_list_id ?? undefined,
        plan_id: task.plan_id ?? undefined,
        assigned_to: task.assigned_to ?? undefined,
        tags: task.tags,
        metadata: { ...task.metadata, _retry: { original_id: task.id, retry_count: retryCount, max_retries: maxRetries, retry_after: retryAfter, failure_reason: reason } },
        estimated_minutes: task.estimated_minutes ?? undefined,
        recurrence_rule: task.recurrence_rule ?? undefined,
        due_at: retryAfter,
      }, d);

      // Set retry fields on the new task
      d.run("UPDATE tasks SET retry_count = ?, max_retries = ?, retry_after = ? WHERE id = ?",
        [retryCount, maxRetries, retryAfter, retryTask.id]);
    }
  }

  return { task: failedTask, retryTask };
}

export function getStaleTasks(
  staleMinutes: number = 30,
  filters?: { project_id?: string; task_list_id?: string },
  db?: Database,
): Task[] {
  const d = db || getDatabase();
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();

  const conditions: string[] = [
    "status = 'in_progress'",
    "(updated_at < ? OR (locked_at IS NOT NULL AND locked_at < ?))",
  ];
  const params: SQLQueryBindings[] = [cutoff, cutoff];

  if (filters?.project_id) { conditions.push("project_id = ?"); params.push(filters.project_id); }
  if (filters?.task_list_id) { conditions.push("task_list_id = ?"); params.push(filters.task_list_id); }

  const where = conditions.join(" AND ");
  const rows = d.query(
    `SELECT * FROM tasks WHERE ${where} ORDER BY updated_at ASC`
  ).all(...params) as TaskRow[];

  return rows.map(rowToTask);
}

/**
 * Log cost (tokens + USD) to a task. Accumulates — does not replace.
 */
export function logCost(taskId: string, tokens: number, usd: number, db?: Database): void {
  const d = db || getDatabase();
  d.run(
    "UPDATE tasks SET cost_tokens = cost_tokens + ?, cost_usd = cost_usd + ?, updated_at = ? WHERE id = ?",
    [tokens, usd, now(), taskId],
  );
}

/**
 * Work-stealing: find the highest-priority stale in_progress task and reassign it to the given agent.
 * A task is stealable if it's in_progress and its lock/update is older than staleMinutes.
 */
export function stealTask(
  agentId: string,
  opts?: { stale_minutes?: number; project_id?: string; task_list_id?: string },
  db?: Database,
): Task | null {
  const d = db || getDatabase();
  const staleMinutes = opts?.stale_minutes ?? 30;
  const staleTasks = getStaleTasks(staleMinutes, { project_id: opts?.project_id, task_list_id: opts?.task_list_id }, d);
  if (staleTasks.length === 0) return null;

  // Pick highest priority stale task
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  staleTasks.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));
  const target = staleTasks[0]!;

  const timestamp = now();
  d.run(
    `UPDATE tasks SET assigned_to = ?, locked_by = ?, locked_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
    [agentId, agentId, timestamp, timestamp, target.id],
  );

  logTaskChange(target.id, "steal", "assigned_to", target.assigned_to, agentId, agentId, d);
  dispatchWebhook("task.assigned", { id: target.id, agent_id: agentId, title: target.title, stolen_from: target.assigned_to }, d).catch(() => {});

  return { ...target, assigned_to: agentId, locked_by: agentId, locked_at: timestamp, updated_at: timestamp, version: target.version + 1 };
}

/**
 * Enhanced claim: try pending queue first, then steal from stale agents if nothing pending.
 */
export function claimOrSteal(
  agentId: string,
  filters?: { project_id?: string; task_list_id?: string; plan_id?: string; tags?: string[]; stale_minutes?: number },
  db?: Database,
): { task: Task; stolen: boolean } | null {
  const d = db || getDatabase();
  const tx = d.transaction(() => {
    // Try normal claim first
    const next = getNextTask(agentId, filters, d);
    if (next) {
      const started = startTask(next.id, agentId, d);
      return { task: started, stolen: false };
    }
    // Fall back to work-stealing
    const stolen = stealTask(agentId, { stale_minutes: filters?.stale_minutes, project_id: filters?.project_id, task_list_id: filters?.task_list_id }, d);
    if (stolen) return { task: stolen, stolen: true };
    return null;
  });
  return tx();
}

export interface StatusSummary {
  pending: number;
  in_progress: number;
  completed: number;
  total: number;
  active_work: ActiveWorkItem[];
  next_task: Task | null;
  stale_count: number;
  overdue_recurring: number;
  blocked_tasks?: {
    id: string;
    short_id: string | null;
    title: string;
    blocked_by: { id: string; short_id: string | null; title: string; status: string }[];
  }[];
}

export function getStatus(
  filters?: { project_id?: string; task_list_id?: string },
  agentId?: string,
  options?: { explain_blocked?: boolean },
  db?: Database,
): StatusSummary {
  const d = db || getDatabase();

  const pending = countTasks({ ...filters, status: "pending" }, d);
  const in_progress = countTasks({ ...filters, status: "in_progress" }, d);
  const completed = countTasks({ ...filters, status: "completed" }, d);
  const total = countTasks(filters || {}, d);
  const active_work = getActiveWork(filters, d);
  const next_task = getNextTask(agentId, filters, d);
  const stale = getStaleTasks(30, filters, d);

  const conditions: string[] = ["recurrence_rule IS NOT NULL", "status = 'pending'", "due_at < ?"];
  const params: SQLQueryBindings[] = [now()];
  if (filters?.project_id) { conditions.push("project_id = ?"); params.push(filters.project_id); }
  if (filters?.task_list_id) { conditions.push("task_list_id = ?"); params.push(filters.task_list_id); }
  const overdueRow = d.query(`SELECT COUNT(*) as count FROM tasks WHERE ${conditions.join(" AND ")}`).get(...params) as { count: number };

  const summary: StatusSummary = {
    pending,
    in_progress,
    completed,
    total,
    active_work,
    next_task,
    stale_count: stale.length,
    overdue_recurring: overdueRow.count,
  };

  if (options?.explain_blocked) {
    const pendingTasks = listTasks({ ...filters, status: "pending" }, d);
    const blockedTasks: NonNullable<StatusSummary["blocked_tasks"]> = [];
    for (const t of pendingTasks) {
      const blockingDeps = getBlockingDeps(t.id, d);
      if (blockingDeps.length > 0) {
        blockedTasks.push({
          id: t.id,
          short_id: t.short_id,
          title: t.title,
          blocked_by: blockingDeps.map(b => ({ id: b.id, short_id: b.short_id, title: b.title, status: b.status })),
        });
      }
    }
    summary.blocked_tasks = blockedTasks;
  }

  return summary;
}

export interface DecomposeSubtaskInput {
  title: string;
  description?: string;
  priority?: Task["priority"];
  assigned_to?: string;
  estimated_minutes?: number;
  tags?: string[];
}

export function decomposeTasks(
  parentId: string,
  subtasks: DecomposeSubtaskInput[],
  options?: { depends_on_prev?: boolean },
  db?: Database,
): { parent: Task; subtasks: Task[] } {
  const d = db || getDatabase();
  const parent = getTask(parentId, d);
  if (!parent) throw new TaskNotFoundError(parentId);

  const created: Task[] = [];

  const tx = d.transaction(() => {
    for (const input of subtasks) {
      const task = createTask({
        title: input.title,
        description: input.description,
        priority: input.priority || parent.priority,
        parent_id: parentId,
        project_id: parent.project_id || undefined,
        plan_id: parent.plan_id || undefined,
        task_list_id: parent.task_list_id || undefined,
        assigned_to: input.assigned_to || parent.assigned_to || undefined,
        estimated_minutes: input.estimated_minutes,
        tags: input.tags,
      }, d);

      // Chain dependencies: each subtask depends on the previous
      if (options?.depends_on_prev && created.length > 0) {
        const prev = created[created.length - 1]!;
        addDependency(task.id, prev.id, d);
      }

      created.push(task);
    }
  });
  tx();

  return { parent, subtasks: created };
}

export function setTaskStatus(
  id: string,
  status: TaskStatus,
  _agentId?: string,
  db?: Database,
): Task {
  const d = db || getDatabase();
  for (let attempt = 0; attempt < 3; attempt++) {
    const task = getTask(id, d);
    if (!task) throw new TaskNotFoundError(id);
    if (task.status === status) return task; // already set, no-op
    try {
      return updateTask(id, { status, version: task.version }, d);
    } catch (e) {
      if (e instanceof VersionConflictError && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error(`Failed to set status after 3 attempts`);
}

export function setTaskPriority(
  id: string,
  priority: TaskPriority,
  _agentId?: string,
  db?: Database,
): Task {
  const d = db || getDatabase();
  for (let attempt = 0; attempt < 3; attempt++) {
    const task = getTask(id, d);
    if (!task) throw new TaskNotFoundError(id);
    if (task.priority === priority) return task;
    try {
      return updateTask(id, { priority, version: task.version }, d);
    } catch (e) {
      if (e instanceof VersionConflictError && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error(`Failed to set priority after 3 attempts`);
}

export function redistributeStaleTasks(
  agentId: string,
  options?: { max_age_minutes?: number; project_id?: string; limit?: number },
  db?: Database,
): { released: Task[]; claimed: Task | null } {
  const d = db || getDatabase();
  const maxAge = options?.max_age_minutes ?? 60;
  const stale = getStaleTasks(maxAge, options?.project_id ? { project_id: options.project_id } : undefined, d);
  const limited = options?.limit ? stale.slice(0, options.limit) : stale;

  // Release locks on all stale tasks
  const timestamp = now();
  const released: Task[] = [];
  for (const t of limited) {
    d.run(
      `UPDATE tasks SET locked_by = NULL, locked_at = NULL, status = 'pending', version = version + 1, updated_at = ? WHERE id = ?`,
      [timestamp, t.id],
    );
    released.push({ ...t, locked_by: null, locked_at: null, status: "pending" as const });
  }

  // Optionally claim the highest-priority one
  const claimed =
    released.length > 0
      ? claimNextTask(agentId, options?.project_id ? { project_id: options.project_id } : undefined, d)
      : null;

  return { released, claimed };
}

function wouldCreateCycle(
  taskId: string,
  dependsOn: string,
  db: Database,
): boolean {
  // BFS from dependsOn to see if we can reach taskId
  const visited = new Set<string>();
  const queue = [dependsOn];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const deps = db
      .query("SELECT depends_on FROM task_dependencies WHERE task_id = ?")
      .all(current) as { depends_on: string }[];

    for (const dep of deps) {
      queue.push(dep.depends_on);
    }
  }

  return false;
}

export function getTaskStats(
  filters?: { project_id?: string; task_list_id?: string; agent_id?: string },
  db?: Database,
): { total: number; by_status: Record<string, number>; by_priority: Record<string, number>; completion_rate: number; by_agent: Record<string, number> } {
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (filters?.project_id) { conditions.push("project_id = ?"); params.push(filters.project_id); }
  if (filters?.task_list_id) { conditions.push("task_list_id = ?"); params.push(filters.task_list_id); }
  if (filters?.agent_id) { conditions.push("(agent_id = ? OR assigned_to = ?)"); params.push(filters.agent_id, filters.agent_id); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const totalRow = d.query(`SELECT COUNT(*) as count FROM tasks ${where}`).get(...params) as { count: number };

  const statusRows = d.query(`SELECT status, COUNT(*) as count FROM tasks ${where} GROUP BY status`).all(...params) as { status: string; count: number }[];
  const by_status: Record<string, number> = {};
  for (const r of statusRows) by_status[r.status] = r.count;

  const priorityRows = d.query(`SELECT priority, COUNT(*) as count FROM tasks ${where} GROUP BY priority`).all(...params) as { priority: string; count: number }[];
  const by_priority: Record<string, number> = {};
  for (const r of priorityRows) by_priority[r.priority] = r.count;

  const agentRows = d.query(`SELECT COALESCE(assigned_to, agent_id, 'unassigned') as agent, COUNT(*) as count FROM tasks ${where} GROUP BY agent`).all(...params) as { agent: string; count: number }[];
  const by_agent: Record<string, number> = {};
  for (const r of agentRows) by_agent[r.agent] = r.count;

  const completed = by_status["completed"] || 0;
  const completion_rate = totalRow.count > 0 ? Math.round((completed / totalRow.count) * 100) : 0;

  return { total: totalRow.count, by_status, by_priority, completion_rate, by_agent };
}

export interface BulkCreateTaskInput {
  temp_id?: string;
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "critical";
  status?: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  project_id?: string;
  parent_id?: string;
  plan_id?: string;
  task_list_id?: string;
  agent_id?: string;
  assigned_to?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  estimated_minutes?: number;
  depends_on_temp_ids?: string[];
}

export function bulkCreateTasks(
  inputs: BulkCreateTaskInput[],
  db?: Database,
): { created: { temp_id: string | null; id: string; short_id: string | null; title: string }[] } {
  const d = db || getDatabase();
  const tempIdToRealId = new Map<string, string>();
  const created: { temp_id: string | null; id: string; short_id: string | null; title: string }[] = [];

  const tx = d.transaction(() => {
    // First pass: create all tasks
    for (const input of inputs) {
      const { temp_id, depends_on_temp_ids: _deps, ...createInput } = input;
      const task = createTask(createInput, d);
      if (temp_id) tempIdToRealId.set(temp_id, task.id);
      created.push({ temp_id: temp_id || null, id: task.id, short_id: task.short_id, title: task.title });
    }

    // Second pass: wire up dependencies using temp_id mappings
    for (const input of inputs) {
      if (input.depends_on_temp_ids && input.depends_on_temp_ids.length > 0) {
        const taskId = input.temp_id ? tempIdToRealId.get(input.temp_id) : null;
        if (!taskId) continue;
        for (const depTempId of input.depends_on_temp_ids) {
          const depRealId = tempIdToRealId.get(depTempId);
          if (depRealId) {
            addDependency(taskId, depRealId, d);
          }
        }
      }
    }
  });
  tx();

  return { created };
}

export function bulkUpdateTasks(
  taskIds: string[],
  updates: { status?: Task["status"]; priority?: Task["priority"]; assigned_to?: string; tags?: string[] },
  db?: Database,
): { updated: number; failed: { id: string; error: string }[] } {
  const d = db || getDatabase();
  let updated = 0;
  const failed: { id: string; error: string }[] = [];

  const tx = d.transaction(() => {
    for (const id of taskIds) {
      try {
        const task = getTask(id, d);
        if (!task) {
          failed.push({ id, error: "Task not found" });
          continue;
        }
        updateTask(id, { ...updates, version: task.version }, d);
        updated++;
      } catch (e) {
        failed.push({ id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  });
  tx();

  return { updated, failed };
}

/**
 * Archive tasks matching the criteria. Archives completed/failed/cancelled tasks
 * older than `olderThanDays` days. Returns count of archived tasks.
 */
export function archiveTasks(options: {
  project_id?: string;
  task_list_id?: string;
  older_than_days?: number;
  status?: TaskStatus[];
}, db?: Database): { archived: number } {
  const d = db || getDatabase();
  const conditions: string[] = ["archived_at IS NULL"];
  const params: SQLQueryBindings[] = [];

  const statuses = options.status ?? ["completed", "failed", "cancelled"];
  conditions.push(`status IN (${statuses.map(() => "?").join(",")})`);
  params.push(...statuses);

  if (options.project_id) {
    conditions.push("project_id = ?");
    params.push(options.project_id);
  }
  if (options.task_list_id) {
    conditions.push("task_list_id = ?");
    params.push(options.task_list_id);
  }
  if (options.older_than_days !== undefined) {
    const cutoff = new Date(Date.now() - options.older_than_days * 86400000).toISOString();
    conditions.push("updated_at < ?");
    params.push(cutoff);
  }

  const ts = now();
  const result = d.run(
    `UPDATE tasks SET archived_at = ? WHERE ${conditions.join(" AND ")}`,
    [ts, ...params],
  );
  return { archived: result.changes };
}

/**
 * Unarchive (restore) a specific task.
 */
export function unarchiveTask(id: string, db?: Database): Task | null {
  const d = db || getDatabase();
  d.run("UPDATE tasks SET archived_at = NULL WHERE id = ?", [id]);
  return getTask(id, d);
}

export function getOverdueTasks(projectId?: string, db?: Database): Task[] {
  const d = db || getDatabase();
  const nowStr = new Date().toISOString();
  let query = `SELECT * FROM tasks WHERE due_at IS NOT NULL AND due_at < ? AND status NOT IN ('completed', 'cancelled', 'failed')`;
  const params: any[] = [nowStr];
  if (projectId) { query += ` AND project_id = ?`; params.push(projectId); }
  query += ` ORDER BY due_at ASC`;
  const rows = d.query(query).all(...params) as TaskRow[];
  return rows.map(rowToTask);
}
