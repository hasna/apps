import type { Database, SQLQueryBindings } from "bun:sqlite";
import type {
  CreateTaskInput,
  Task,
  TaskFilter,
  TaskRow,
  TaskWithRelations,
  UpdateTaskInput,
} from "../types/index.js";
import {
  TaskNotFoundError,
  VersionConflictError,
} from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { checkCompletionGuard } from "../lib/completion-guard.js";
import { logTaskChange } from "./audit.js";
import { dispatchWebhook } from "./webhooks.js";
import { getChecklist } from "./checklists.js";

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

export function createTask(input: CreateTaskInput, db?: Database): Task {
  const d = db || getDatabase();
  const timestamp = now();
  const tags = input.tags || [];

  // assigned_by = who created this task (always the calling agent)
  // assigned_from_project = which project they were in when they assigned it
  const assignedBy = input.assigned_by || input.agent_id;
  const assignedFromProject = input.assigned_from_project || null;

  // Retry with a fresh UUID on the rare chance of a nanoid collision
  let id = uuid();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      d.run(
        `INSERT INTO tasks (id, short_id, project_id, parent_id, plan_id, task_list_id, cycle_id, title, description, status, priority, agent_id, assigned_to, session_id, working_dir, tags, metadata, version, created_at, updated_at, due_at, estimated_minutes, requires_approval, approved_by, approved_at, recurrence_rule, recurrence_parent_id, spawns_template_id, reason, spawned_from_session, assigned_by, assigned_from_project, task_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
