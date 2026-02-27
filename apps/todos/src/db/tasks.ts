import type { Database, SQLQueryBindings } from "bun:sqlite";
import type {
  CreateTaskInput,
  LockResult,
  Task,
  TaskDependency,
  TaskFilter,
  TaskRow,
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

function rowToTask(row: TaskRow): Task {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]") as string[],
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
    status: row.status as Task["status"],
    priority: row.priority as Task["priority"],
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

  d.run(
    `INSERT INTO tasks (id, project_id, parent_id, plan_id, task_list_id, title, description, status, priority, agent_id, assigned_to, session_id, working_dir, tags, metadata, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      input.project_id || null,
      input.parent_id || null,
      input.plan_id || null,
      input.task_list_id || null,
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
    ],
  );

  if (tags.length > 0) {
    insertTaskTags(id, tags, d);
  }

  return getTask(id, d)!;
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

  return {
    ...task,
    subtasks,
    dependencies,
    blocked_by,
    comments,
    parent,
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

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const limitVal = filter.limit || 100;
  const offsetVal = filter.offset || 0;
  params.push(limitVal, offsetVal);

  const rows = d
    .query(
      `SELECT * FROM tasks ${where} ORDER BY
       CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
       created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params) as TaskRow[];

  return rows.map(rowToTask);
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

  params.push(id, input.version);

  const result = d.run(
    `UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND version = ?`,
    params,
  );

  if (result.changes === 0) {
    // Re-fetch to get actual version for error message
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

  return getTask(id, d)!;
}

export function deleteTask(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM tasks WHERE id = ?", [id]);
  return result.changes > 0;
}

export function startTask(
  id: string,
  agentId: string,
  db?: Database,
): Task {
  const d = db || getDatabase();
  const cutoff = lockExpiryCutoff();
  const timestamp = now();
  const result = d.run(
    `UPDATE tasks SET status = 'in_progress', assigned_to = ?, locked_by = ?, locked_at = ?, version = version + 1, updated_at = ?
     WHERE id = ? AND (locked_by IS NULL OR locked_by = ? OR locked_at < ?)`,
    [agentId, agentId, timestamp, timestamp, id, agentId, cutoff],
  );

  if (result.changes === 0) {
    const current = getTask(id, d);
    if (!current) throw new TaskNotFoundError(id);
    if (current.locked_by && current.locked_by !== agentId && !isLockExpired(current.locked_at)) {
      throw new LockError(id, current.locked_by);
    }
  }

  return getTask(id, d)!;
}

export function completeTask(
  id: string,
  agentId?: string,
  db?: Database,
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

  const timestamp = now();
  d.run(
    `UPDATE tasks SET status = 'completed', locked_by = NULL, locked_at = NULL, completed_at = ?, version = version + 1, updated_at = ?
     WHERE id = ?`,
    [timestamp, timestamp, id],
  );

  return getTask(id, d)!;
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
