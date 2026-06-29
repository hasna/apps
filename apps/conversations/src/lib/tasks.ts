import { getDb } from "./db.js";
import { randomUUID } from "crypto";
import { fireTaskWebhooks } from "./webhooks.js";
import { normalizeChannelName } from "./channel-names.js";
import type {
  Task,
  TaskInfo,
  TaskComment,
  TaskActivity,
  CreateTaskOptions,
  ListTasksOptions,
  SearchTasksOptions,
  SearchResultTask,
  TaskStatus,
  TaskPriority,
} from "../types.js";

function parseTask(row: Record<string, unknown>): Task {
  let dependsOn: string[] | null = null;
  if (row.depends_on) {
    try { dependsOn = JSON.parse(row.depends_on as string); } catch { dependsOn = null; }
  }
  let tags: string[] | null = null;
  if (row.tags) {
    try { tags = JSON.parse(row.tags as string); } catch { tags = null; }
  }
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try { metadata = JSON.parse(row.metadata as string); } catch { metadata = null; }
  }

  return {
    id: row.id as number,
    uuid: row.uuid as string,
    subject: row.subject as string,
    description: (row.description as string) || null,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    assignee: (row.assignee as string) || null,
    reporter: row.reporter as string,
    project_id: (row.project_id as string) || null,
    channel: (row.channel as string) || null,
    parent_id: (row.parent_id as number) || null,
    depends_on: dependsOn,
    tags,
    metadata,
    created_at: row.created_at as string,
    started_at: (row.started_at as string) || null,
    completed_at: (row.completed_at as string) || null,
    cancelled_at: (row.cancelled_at as string) || null,
    due_at: (row.due_at as string) || null,
  };
}

function logActivity(taskId: number, agent: string, action: string, detail?: string): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO task_activity (task_id, agent, action, detail) VALUES (?, ?, ?, ?)"
  ).run(taskId, agent, action, detail || null);
}

function emitTaskEvent(task: Task, action: string, agent: string, oldStatus: string, detail?: string): void {
  fireTaskWebhooks({
    task_id: task.id,
    task_uuid: task.uuid,
    subject: task.subject,
    action,
    old_status: oldStatus,
    new_status: task.status,
    agent,
    detail,
    priority: task.priority,
    assignee: task.assignee,
    project_id: task.project_id,
    created_at: task.created_at,
  });
}

// ── Create / Read / List ──────────────────────────────────────────────────────

export function createTask(opts: CreateTaskOptions): Task {
  const db = getDb();
  const uuid = randomUUID().replace(/-/g, "");
  const priority = opts.priority || "medium";
  const description = opts.description || null;
  const assignee = opts.assignee || null;
  const project_id = opts.project_id || null;
  const channel = opts.channel ? normalizeChannelName(opts.channel) : null;
  const parent_id = opts.parent_id || null;
  const tags = opts.tags ? JSON.stringify(opts.tags) : null;
  const metadata = opts.metadata ? JSON.stringify(opts.metadata) : null;
  const due_at = opts.due_at || null;

  const row = db.prepare(`
    INSERT INTO tasks (uuid, subject, description, reporter, assignee, priority, project_id, channel, parent_id, tags, metadata, due_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    uuid,
    opts.subject,
    description,
    opts.reporter,
    assignee,
    priority,
    project_id,
    channel,
    parent_id,
    tags,
    metadata,
    due_at,
  ) as Record<string, unknown>;

  const task = parseTask(row);

  // Set up dependencies
  if (opts.depends_on && opts.depends_on.length > 0) {
    const depIds = opts.depends_on;
    const insertDep = db.prepare(
      "INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)"
    );
    const depIdsResolved: number[] = [];
    for (const depId of depIds) {
      const exists = db.prepare("SELECT id, status FROM tasks WHERE id = ?").get(depId) as { id: number; status: string } | null;
      if (!exists) throw new Error(`Dependency task #${depId} not found`);
      insertDep.run(task.id, depId);
      depIdsResolved.push(depId);
    }

    // Update depends_on JSON blob on the task
    db.prepare("UPDATE tasks SET depends_on = ? WHERE id = ?")
      .run(JSON.stringify(depIdsResolved), task.id);

    // Block if any dependency is not completed
    const incompleteDeps = db.prepare(
      "SELECT depends_on_id FROM task_dependencies WHERE task_id = ? AND depends_on_id IN (SELECT id FROM tasks WHERE status != 'completed')"
    ).all(task.id);

    if (incompleteDeps.length > 0) {
      db.prepare("UPDATE tasks SET status = 'blocked' WHERE id = ?").run(task.id);
    }
  }

  // Log creation
  logActivity(task.id, opts.reporter, "created");

  const created = parseTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id) as Record<string, unknown>);

  fireTaskWebhooks({
    task_id: created.id,
    task_uuid: created.uuid,
    subject: created.subject,
    action: "created",
    new_status: created.status,
    agent: opts.reporter,
    priority: created.priority,
    assignee: created.assignee,
    project_id: created.project_id,
    created_at: created.created_at,
  });

  return created;
}

export function getTask(idOrUuid: number | string): TaskInfo | null {
  const db = getDb();
  let row: Record<string, unknown> | null = null;

  if (typeof idOrUuid === "number") {
    row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(idOrUuid) as Record<string, unknown> | null;
  } else {
    row = db.prepare("SELECT * FROM tasks WHERE uuid = ?").get(idOrUuid) as Record<string, unknown> | null;
  }

  if (!row) return null;
  return enrichTask(row);
}

export function listTasks(opts: ListTasksOptions = {}): TaskInfo[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts.status) { conditions.push("t.status = ?"); params.push(opts.status); }
  if (opts.assignee) { conditions.push("t.assignee = ?"); params.push(opts.assignee); }
  if (opts.reporter) { conditions.push("t.reporter = ?"); params.push(opts.reporter); }
  if (opts.project_id) { conditions.push("t.project_id = ?"); params.push(opts.project_id); }
  if (opts.channel) { conditions.push("t.channel = ?"); params.push(normalizeChannelName(opts.channel)); }
  if (opts.priority) { conditions.push("t.priority = ?"); params.push(opts.priority); }
  if (opts.tag) { conditions.push("t.tags LIKE ?"); params.push(`%"${opts.tag}"%`); }
  if (opts.tags && opts.tags.length > 0) {
    // AND logic: all tags must be present
    for (const tag of opts.tags) {
      conditions.push("t.tags LIKE ?");
      params.push(`%"${tag}"%`);
    }
  }
  if (opts.metadata && Object.keys(opts.metadata).length > 0) {
    // Filter by metadata key/value pairs — use JSON_EXTRACT
    for (const [key, value] of Object.entries(opts.metadata)) {
      if (typeof value === "string") {
        conditions.push(`t.metadata LIKE ?`);
        params.push(`%"${key}":"${value}"%`);
      } else if (typeof value === "number" || typeof value === "boolean") {
        conditions.push(`t.metadata LIKE ?`);
        params.push(`%"${key}":${value}%`);
      } else {
        conditions.push(`t.metadata LIKE ?`);
        params.push(`%"${key}"%`);
      }
    }
  }

  if (opts.parent_id === null) {
    conditions.push("t.parent_id IS NULL");
  } else if (typeof opts.parent_id === "number") {
    conditions.push("t.parent_id = ?");
    params.push(opts.parent_id);
  }

  if (!opts.include_archived) {
    conditions.push("t.status != 'cancelled'");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const limit = Number.isFinite(opts.limit) && (opts.limit as number) > 0 ? Math.floor(opts.limit as number) : 50;
  const offset = Number.isFinite(opts.offset) && (opts.offset as number) >= 0 ? Math.floor(opts.offset as number) : 0;

  const rows = db.prepare(`
    SELECT t.* FROM tasks t
    ${where}
    ORDER BY
      CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
      t.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Record<string, unknown>[];

  return rows.map(enrichTask);
}

// ── State transitions ─────────────────────────────────────────────────────────

export function startTask(id: number | string, agent?: string): Task | null {
  const db = getDb();
  const task = resolveTask(id);
  if (!task) return null;

  // Check dependencies — can't start if any dependency is incomplete
  const incompleteDeps = db.prepare(`
    SELECT td.depends_on_id, t.subject, t.status
    FROM task_dependencies td
    JOIN tasks t ON t.id = td.depends_on_id
    WHERE td.task_id = ? AND t.status != 'completed'
  `).all(task.id) as Array<{ depends_on_id: number; subject: string; status: string }>;

  if (incompleteDeps.length > 0) {
    throw new Error(`Cannot start: blocked by ${incompleteDeps.length} incomplete task(s): ${incompleteDeps.map(d => `#${d.depends_on_id} "${d.subject}" (${d.status})`).join(", ")}`);
  }

  const now = new Date().toISOString();
  const oldStatus = task.status;
  db.prepare("UPDATE tasks SET status = 'in_progress', started_at = ? WHERE id = ?").run(now, task.id);
  logActivity(task.id, agent || task.reporter, "started");
  const updated = getTaskById(task.id);
  if (updated) emitTaskEvent(updated, "started", agent || task.reporter, oldStatus);
  return updated;
}

export function completeTask(id: number | string, agent?: string, opts?: { evidence?: string }): Task | null {
  const db = getDb();
  const task = resolveTask(id);
  if (!task) return null;

  const now = new Date().toISOString();
  const oldStatus = task.status;
  db.prepare("UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?").run(now, task.id);
  logActivity(task.id, agent || task.reporter, "completed", opts?.evidence);

  // Unblock any tasks that were waiting on this one
  unblockDependents(task.id);

  const updated = getTaskById(task.id);
  if (updated) emitTaskEvent(updated, "completed", agent || task.reporter, oldStatus, opts?.evidence);
  return updated;
}

export function cancelTask(id: number | string, agent?: string, opts?: { reason?: string }): Task | null {
  const db = getDb();
  const task = resolveTask(id);
  if (!task) return null;

  const now = new Date().toISOString();
  const oldStatus = task.status;
  db.prepare("UPDATE tasks SET status = 'cancelled', cancelled_at = ? WHERE id = ?").run(now, task.id);
  logActivity(task.id, agent || task.reporter, "cancelled", opts?.reason);
  const updated = getTaskById(task.id);
  if (updated) emitTaskEvent(updated, "cancelled", agent || task.reporter, oldStatus, opts?.reason);
  return updated;
}

export function blockTask(id: number | string, agent?: string, opts?: { reason?: string }): Task | null {
  const db = getDb();
  const task = resolveTask(id);
  if (!task) return null;

  const oldStatus = task.status;
  db.prepare("UPDATE tasks SET status = 'blocked' WHERE id = ?").run(task.id);
  logActivity(task.id, agent || task.reporter, "blocked", opts?.reason);
  const updated = getTaskById(task.id);
  if (updated) emitTaskEvent(updated, "blocked", agent || task.reporter, oldStatus, opts?.reason);
  return updated;
}

export function unblockTask(id: number | string, agent?: string): Task | null {
  const db = getDb();
  const task = resolveTask(id);
  if (!task) return null;

  // Check if still blocked by dependencies
  const incompleteDeps = db.prepare(`
    SELECT 1 FROM task_dependencies td
    JOIN tasks t ON t.id = td.depends_on_id
    WHERE td.task_id = ? AND t.status != 'completed'
    LIMIT 1
  `).get(task.id);

  const oldStatus = task.status;
  const newStatus = incompleteDeps ? "blocked" : "pending";
  db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(newStatus, task.id);
  logActivity(task.id, agent || task.reporter, "unblocked");
  const updated = getTaskById(task.id);
  if (updated) emitTaskEvent(updated, "unblocked", agent || task.reporter, oldStatus);
  return updated;
}

export function reopenTask(id: number | string, agent?: string): Task | null {
  const db = getDb();
  const task = resolveTask(id);
  if (!task) return null;

  const oldStatus = task.status;
  db.prepare("UPDATE tasks SET status = 'pending', completed_at = NULL, cancelled_at = NULL WHERE id = ?").run(task.id);
  logActivity(task.id, agent || task.reporter, "reopened");

  // Re-check dependencies
  const incompleteDeps = db.prepare(`
    SELECT 1 FROM task_dependencies td
    JOIN tasks t ON t.id = td.depends_on_id
    WHERE td.task_id = ? AND t.status != 'completed'
    LIMIT 1
  `).get(task.id);

  const updated = getTaskById(task.id);
  if (updated) emitTaskEvent(updated, "reopened", agent || task.reporter, oldStatus);
  return updated;
}

export function assignTask(id: number | string, assignee: string, agent?: string): Task | null {
  const db = getDb();
  const task = resolveTask(id);
  if (!task) return null;

  db.prepare("UPDATE tasks SET assignee = ? WHERE id = ?").run(assignee, task.id);
  logActivity(task.id, agent || task.reporter, "assigned", assignee);
  const updated = getTaskById(task.id);
  if (updated) emitTaskEvent(updated, "assigned", agent || task.reporter, task.status);
  return updated;
}

export function setTaskPriority(id: number | string, priority: TaskPriority, agent?: string): Task | null {
  const db = getDb();
  const task = resolveTask(id);
  if (!task) return null;

  const oldPriority = task.priority;
  db.prepare("UPDATE tasks SET priority = ? WHERE id = ?").run(priority, task.id);
  logActivity(task.id, agent || task.reporter, "priority_changed", `${oldPriority} -> ${priority}`);
  const updated = getTaskById(task.id);
  if (updated) emitTaskEvent(updated, "priority_changed", agent || task.reporter, task.status, `${oldPriority} -> ${priority}`);
  return updated;
}

// ── Comments ──────────────────────────────────────────────────────────────────

export function addComment(taskId: number | string, agent: string, content: string): TaskComment {
  const db = getDb();
  const task = resolveTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const row = db.prepare(
    "INSERT INTO task_comments (task_id, agent, content) VALUES (?, ?, ?) RETURNING *"
  ).get(task.id, agent, content) as Record<string, unknown>;

  logActivity(task.id, agent, "comment", content.length > 200 ? content.slice(0, 200) + "…" : content);

  return {
    id: row.id as number,
    task_id: row.task_id as number,
    agent: row.agent as string,
    content: row.content as string,
    created_at: row.created_at as string,
  };
}

export function getComments(taskId: number | string): TaskComment[] {
  const db = getDb();
  const task = resolveTask(taskId);
  if (!task) return [];

  return db.prepare(
    "SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC, id ASC"
  ).all(task.id) as TaskComment[];
}

// ── Subtasks ──────────────────────────────────────────────────────────────────

export function getSubtasks(parentId: number | string): TaskInfo[] {
  const db = getDb();
  const parent = resolveTask(parentId);
  if (!parent) return [];

  const rows = db.prepare(
    "SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at ASC, id ASC"
  ).all(parent.id) as Record<string, unknown>[];

  return rows.map(enrichTask);
}

export function getTaskTree(parentId: number | string, maxDepth = 5): TaskInfo & { children: TaskInfo[] } {
  const root = getTask(typeof parentId === "number" ? parentId : parentId);
  if (!root) throw new Error(`Task not found: ${parentId}`);

  const buildTree = (task: TaskInfo, depth: number): TaskInfo & { children: TaskInfo[] } => {
    if (depth >= maxDepth) return { ...task, children: [] };
    const children = getSubtasks(task.id);
    return { ...task, children: children.map(c => buildTree(c, depth + 1)) };
  };

  return buildTree(root, 0);
}

// ── Dependencies ──────────────────────────────────────────────────────────────

export function addDependency(taskId: number | string, dependsOnId: number | string): void {
  const db = getDb();
  const task = resolveTask(taskId);
  const dep = resolveTask(dependsOnId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (!dep) throw new Error(`Dependency task not found: ${dependsOnId}`);
  if (task.id === dep.id) throw new Error("A task cannot depend on itself");

  // Prevent circular dependencies
  if (isCircularDependency(task.id, dep.id)) {
    throw new Error(`Circular dependency detected: task #${task.id} -> #${dep.id}`);
  }

  db.prepare(
    "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)"
  ).run(task.id, dep.id);

  // Update JSON blob
  const deps = db.prepare("SELECT depends_on_id FROM task_dependencies WHERE task_id = ?").all(task.id) as Array<{ depends_on_id: number }>;
  db.prepare("UPDATE tasks SET depends_on = ? WHERE id = ?").run(JSON.stringify(deps.map(d => d.depends_on_id)), task.id);

  // Block if dependency is not completed
  if (dep.status !== "completed") {
    db.prepare("UPDATE tasks SET status = 'blocked' WHERE id = ?").run(task.id);
  }

  logActivity(task.id, "", "dependency_added", `depends on #${dep.id}`);
}

export function removeDependency(taskId: number | string, dependsOnId: number | string): void {
  const db = getDb();
  const task = resolveTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  db.prepare("DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?").run(task.id, dependsOnId);

  // Update JSON blob
  const deps = db.prepare("SELECT depends_on_id FROM task_dependencies WHERE task_id = ?").all(task.id) as Array<{ depends_on_id: number }>;
  db.prepare("UPDATE tasks SET depends_on = ? WHERE id = ?").run(JSON.stringify(deps.map(d => d.depends_on_id)), task.id);

  logActivity(task.id, "", "dependency_removed", `no longer depends on #${dependsOnId}`);
}

export function getDependencies(taskId: number | string): Task[] {
  const db = getDb();
  const task = resolveTask(taskId);
  if (!task) return [];

  return (db.prepare(`
    SELECT t.* FROM tasks t
    INNER JOIN task_dependencies td ON td.depends_on_id = t.id
    WHERE td.task_id = ?
    ORDER BY t.created_at ASC
  `).all(task.id) as Record<string, unknown>[]).map(parseTask);
}

export function getDependents(taskId: number | string): Task[] {
  const db = getDb();
  const task = resolveTask(taskId);
  if (!task) return [];

  return (db.prepare(`
    SELECT t.* FROM tasks t
    INNER JOIN task_dependencies td ON td.task_id = t.id
    WHERE td.depends_on_id = ?
    ORDER BY t.created_at ASC
  `).all(task.id) as Record<string, unknown>[]).map(parseTask);
}

// ── Activity ──────────────────────────────────────────────────────────────────

export function getTaskActivity(taskId: number | string, limit = 50): TaskActivity[] {
  const db = getDb();
  const task = resolveTask(taskId);
  if (!task) return [];

  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 1000));
  return db.prepare(
    `SELECT * FROM task_activity WHERE task_id = ? ORDER BY created_at DESC LIMIT ${safeLimit}`
  ).all(task.id) as TaskActivity[];
}

// ── Delete ────────────────────────────────────────────────────────────────────

export function deleteTask(id: number | string, agent?: string): boolean {
  const db = getDb();
  const task = resolveTask(id);
  if (!task) return false;

  // Prevent deleting if subtasks exist
  const subtaskCount = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE parent_id = ?").get(task.id) as { c: number }).c;
  if (subtaskCount > 0) {
    throw new Error(`Cannot delete: ${subtaskCount} subtask(s) still reference this task`);
  }

  logActivity(task.id, agent || "", "deleted");
  db.prepare("DELETE FROM tasks WHERE id = ?").run(task.id);
  return true;
}

// ── Full-text search ──────────────────────────────────────────────────────────

/**
 * Search tasks with full-text search on subject, description, and tags.
 * Supports phrase queries (quoted) and prefix matching. Falls back to LIKE if FTS5 is unavailable.
 */
export function searchTasks(opts: SearchTasksOptions): SearchResultTask[] {
  const db = getDb();
  const limit = Number.isFinite(opts.limit) && (opts.limit as number) > 0
    ? Math.floor(opts.limit as number)
    : 20;
  const offset = Number.isFinite(opts.offset) && (opts.offset as number) > 0
    ? Math.floor(opts.offset as number)
    : 0;
  const sortByRelevance = opts.sort !== "recent";
  const query = opts.query.trim();
  const terms = query.split(/\s+/).filter(Boolean);

  // FTS5 approach — two-step: get matching ids from FTS, then fetch enriched tasks
  const ftsAvailable = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks_fts'"
  ).get();

  if (ftsAvailable && terms.length > 0) {
    try {
      let ftsQuery: string;
      if (query.startsWith('"') && query.endsWith('"')) {
        ftsQuery = query;
      } else {
        ftsQuery = terms.map(w => `"${w.replace(/"/g, '""')}"`).join(" ");
      }

      // Get matching task ids ordered by relevance
      const scanLimit = Math.max(limit + offset, limit) * 3;
      const ftsRows = db.prepare(
        `SELECT rowid, rank, snippet(tasks_fts, 0, '**', '**', '...', 10) as snippet
         FROM tasks_fts WHERE tasks_fts MATCH ? ORDER BY rank LIMIT ${scanLimit}`
      ).all(ftsQuery) as Array<{ rowid: number; rank: number; snippet: string }>;

      if (ftsRows.length === 0) {
        // No FTS matches — fall through to LIKE
      } else {
        // Fetch tasks by id
        const ids = ftsRows.map(r => r.rowid);
        const placeholders = ids.map(() => "?").join(",");
        const rows = db.prepare(
          `SELECT * FROM tasks WHERE id IN (${placeholders})`
        ).all(...ids) as Record<string, unknown>[];

        const taskMap = new Map<number, Record<string, unknown>>();
        for (const row of rows) taskMap.set(row.id as number, row);

        const rankMap = new Map(ftsRows.map(r => [r.rowid, { rank: r.rank, snippet: r.snippet }]));
        const sorted = sortByRelevance
          ? [...ftsRows].sort((a, b) => a.rank - b.rank)
          : [...ftsRows].sort((a, b) => {
              const aTask = taskMap.get(a.rowid);
              const bTask = taskMap.get(b.rowid);
              return (bTask?.created_at as string || "").localeCompare(aTask?.created_at as string || "");
            });

        const results: SearchResultTask[] = [];
        const maxRank = Math.abs(sorted[0].rank) || 1;

        for (const fts of sorted) {
          const row = taskMap.get(fts.rowid);
          if (!row) continue;
          const task = enrichTask(row);

          if (opts.status && task.status !== opts.status) continue;
          if (opts.assignee && task.assignee !== opts.assignee) continue;
          if (opts.project_id && task.project_id !== opts.project_id) continue;
          if (opts.channel && task.channel !== normalizeChannelName(opts.channel)) continue;
          if (opts.priority && task.priority !== opts.priority) continue;
          if (!opts.include_archived && task.status === "cancelled") continue;

          results.push({
            ...task,
            snippet: fts.snippet || null,
            relevance_score: Math.round((1 - Math.abs(fts.rank) / maxRank) * 100),
          });

          if (results.length >= limit + offset) break;
        }

        return offset > 0 ? results.slice(offset, offset + limit) : results;
      }
    } catch {
      // FTS5 failed — fall through to LIKE
    }
  }

  // LIKE fallback
  if (terms.length === 0) return [];

  const params: (string | number)[] = [];
  const conditions: string[] = [];
  for (const term of terms) {
    conditions.push("(LOWER(t.subject) LIKE ? OR LOWER(t.description) LIKE ? OR LOWER(t.tags) LIKE ?)");
    const likeTerm = `%${term}%`;
    params.push(likeTerm, likeTerm, likeTerm);
  }

  if (opts.status) { conditions.push("t.status = ?"); params.push(opts.status); }
  if (opts.assignee) { conditions.push("t.assignee = ?"); params.push(opts.assignee); }
  if (opts.project_id) { conditions.push("t.project_id = ?"); params.push(opts.project_id); }
  if (opts.channel) { conditions.push("t.channel = ?"); params.push(normalizeChannelName(opts.channel)); }
  if (opts.priority) { conditions.push("t.priority = ?"); params.push(opts.priority); }
  if (!opts.include_archived) { conditions.push("t.status != 'cancelled'"); }

  const orderClause = sortByRelevance
    ? "ORDER BY CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END, t.created_at DESC"
    : "ORDER BY t.created_at DESC";

  const rows = db.prepare(
    `SELECT t.* FROM tasks t WHERE ${conditions.join(" AND ")} ${orderClause} LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as Record<string, unknown>[];

  return rows.map(row => {
    const task = enrichTask(row);
    const subject = (row.subject as string).toLowerCase();
    const matchCount = terms.filter(t => subject.includes(t)).length;
    return {
      ...task,
      snippet: null,
      relevance_score: Math.round((matchCount / terms.length) * 100),
    };
  });
}

// ── Due date reminders ────────────────────────────────────────────────────────

export interface DueTaskReminder {
  task: TaskInfo;
  due_in_hours: number;
  urgency: "overdue" | "due_today" | "due_soon";
}

/**
 * Get tasks with approaching or past due dates.
 * Returns tasks that are overdue, due today, or due within the given window.
 */
export function getDueTasks(opts: { window_hours?: number } = {}): DueTaskReminder[] {
  const db = getDb();
  const windowHours = opts.window_hours ?? 24;
  const now = new Date();
  const deadline = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

  // Only return non-completed, non-cancelled tasks with a due_at
  const rows = db.prepare(`
    SELECT t.* FROM tasks t
    WHERE t.due_at IS NOT NULL
      AND t.due_at <= ?
      AND t.status NOT IN ('completed', 'cancelled')
    ORDER BY t.due_at ASC
  `).all(deadline.toISOString()) as Record<string, unknown>[];

  return rows.map(row => {
    const task = enrichTask(row);
    const dueAt = new Date(task.due_at!);
    const hoursUntilDue = (dueAt.getTime() - now.getTime()) / (1000 * 60 * 60);
    let urgency: DueTaskReminder["urgency"];
    if (hoursUntilDue < 0) urgency = "overdue";
    else if (hoursUntilDue <= 24) urgency = "due_today";
    else urgency = "due_soon";

    return { task, due_in_hours: Math.round(hoursUntilDue * 10) / 10, urgency };
  });
}

export interface TaskSummary {
  task: TaskInfo;
  progress: {
    total_subtasks: number;
    completed_subtasks: number;
    total_dependencies: number;
    completed_dependencies: number;
    comment_count: number;
    completion_pct: number;
  };
  recent_activity: { action: string; agent: string; detail: string | null; created_at: string }[];
  blockers: { task_id: number; subject: string; status: TaskStatus }[];
  dependents: { task_id: number; subject: string; status: TaskStatus }[];
}

/**
 * Generate a structured summary of a task with progress, activity, and blockers.
 */
export function getTaskSummary(idOrUuid: number | string): TaskSummary | null {
  const db = getDb();
  const task = getTask(idOrUuid);
  if (!task) return null;

  // Subtask progress
  const subtasks = db.prepare(
    "SELECT status FROM tasks WHERE parent_id = ?"
  ).all(task.id) as { status: TaskStatus }[];
  const totalSubtasks = subtasks.length;
  const completedSubtasks = subtasks.filter(s => s.status === "completed").length;

  // Dependency progress
  const depRows = db.prepare(
    "SELECT td.depends_on_id, t.status FROM task_dependencies td JOIN tasks t ON t.id = td.depends_on_id WHERE td.task_id = ?"
  ).all(task.id) as { depends_on_id: number; status: TaskStatus }[];
  const totalDeps = depRows.length;
  const completedDeps = depRows.filter(d => d.status === "completed").length;

  // Comment count
  const commentCount = (db.prepare(
    "SELECT COUNT(*) as c FROM task_comments WHERE task_id = ?"
  ).get(task.id) as { c: number }).c;

  // Completion percentage
  const items = totalSubtasks + totalDeps;
  const completed = completedSubtasks + completedDeps;
  const completionPct = items > 0 ? Math.round((completed / items) * 100) : (task.status === "completed" ? 100 : 0);

  // Recent activity (last 10)
  const activity = db.prepare(
    "SELECT action, agent, detail, created_at FROM task_activity WHERE task_id = ? ORDER BY id DESC LIMIT 10"
  ).all(task.id) as Array<{ action: string; agent: string; detail: string | null; created_at: string }>;

  // Current blockers
  const blockerInfo = db.prepare(
    "SELECT td.depends_on_id as task_id, t.subject, t.status FROM task_dependencies td JOIN tasks t ON t.id = td.depends_on_id WHERE td.task_id = ? AND t.status != 'completed'"
  ).all(task.id) as { task_id: number; subject: string; status: TaskStatus }[];

  // Dependents (tasks blocked by this one)
  const dependentRows = db.prepare(
    "SELECT td.task_id, t.subject, t.status FROM task_dependencies td JOIN tasks t ON t.id = td.task_id WHERE td.depends_on_id = ?"
  ).all(task.id) as { task_id: number; subject: string; status: TaskStatus }[];

  return {
    task,
    progress: {
      total_subtasks: totalSubtasks,
      completed_subtasks: completedSubtasks,
      total_dependencies: totalDeps,
      completed_dependencies: completedDeps,
      comment_count: commentCount,
      completion_pct: completionPct,
    },
    recent_activity: activity,
    blockers: blockerInfo,
    dependents: dependentRows,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function enrichTask(row: Record<string, unknown>): TaskInfo {
  const db = getDb();
  const task = parseTask(row);

  const subtaskCount = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE parent_id = ?").get(task.id) as { c: number }).c;
  const commentCount = (db.prepare("SELECT COUNT(*) as c FROM task_comments WHERE task_id = ?").get(task.id) as { c: number }).c;

  const depRows = db.prepare("SELECT depends_on_id FROM task_dependencies WHERE task_id = ?").all(task.id) as Array<{ depends_on_id: number }>;
  const depCount = depRows.length;

  let blockerInfo: { task_id: number; subject: string; status: TaskStatus }[] = [];
  if (depRows.length > 0) {
    blockerInfo = depRows.map(d => {
      const dep = db.prepare("SELECT id, subject, status FROM tasks WHERE id = ?").get(d.depends_on_id) as { id: number; subject: string; status: string } | null;
      return dep ? { task_id: dep.id, subject: dep.subject, status: dep.status as TaskStatus } : null;
    }).filter(Boolean) as Array<{ task_id: number; subject: string; status: TaskStatus }>;
  }

  return { ...task, subtask_count: subtaskCount, comment_count: commentCount, dependency_count: depCount, blocker_info: blockerInfo };
}

function resolveTask(idOrUuid: number | string): Task | null {
  const db = getDb();
  if (typeof idOrUuid === "number") {
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(idOrUuid) as Record<string, unknown> | null;
    return row ? parseTask(row) : null;
  }
  const row = db.prepare("SELECT * FROM tasks WHERE uuid = ?").get(idOrUuid) as Record<string, unknown> | null;
  return row ? parseTask(row) : null;
}

function getTaskById(id: number): Task | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? parseTask(row) : null;
}

function unblockDependents(completedTaskId: number): void {
  const db = getDb();
  // Find tasks that depend on the completed one and were blocked
  const dependents = db.prepare(`
    SELECT td.task_id, t.status FROM task_dependencies td
    JOIN tasks t ON t.id = td.task_id
    WHERE td.depends_on_id = ?
  `).all(completedTaskId) as Array<{ task_id: number; status: string }>;

  for (const dep of dependents) {
    if (dep.status === "blocked") {
      // Check if ALL dependencies are now completed
      const incompleteCount = (db.prepare(`
        SELECT COUNT(*) as c FROM task_dependencies td
        JOIN tasks t ON t.id = td.depends_on_id
        WHERE td.task_id = ? AND t.status != 'completed'
      `).get(dep.task_id) as { c: number }).c;

      if (incompleteCount === 0) {
        db.prepare("UPDATE tasks SET status = 'pending' WHERE id = ?").run(dep.task_id);
        logActivity(dep.task_id, "", "auto_unblocked", `dependency #${completedTaskId} completed`);
        const task = getTaskById(dep.task_id);
        if (task) emitTaskEvent(task, "auto_unblocked", "system", "blocked", `dependency #${completedTaskId} completed`);
      }
    }
  }
}

function isCircularDependency(taskId: number, dependsOnId: number): boolean {
  // Walk up the dependency chain from dependsOnId — if we hit taskId, it's circular
  const db = getDb();
  const visited = new Set<number>();
  let current: number | undefined = dependsOnId;
  let depth = 0;

  while (current !== undefined && depth < 20) {
    if (current === taskId) return true;
    if (visited.has(current)) break;
    visited.add(current);

    const parents = db.prepare(
      "SELECT depends_on_id FROM task_dependencies WHERE task_id = ?"
    ).all(current) as Array<{ depends_on_id: number }>;

    current = parents.length > 0 ? parents[0].depends_on_id : undefined;
    depth++;
  }

  return false;
}
