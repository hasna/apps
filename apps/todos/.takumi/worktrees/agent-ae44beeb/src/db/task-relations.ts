import type { Database, SQLQueryBindings } from "bun:sqlite";
import type {
  Task,
  TaskRow,
  TaskStatus,
  TaskTimeLog,
  TaskWatcher,
} from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { createTask, getTask, updateTask, rowToTask } from "./task-crud.js";
import { addDependency } from "./task-graph.js";
import { dispatchWebhook } from "./webhooks.js";

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

// ── Time Tracking ────────────────────────────────────────────────────────────────

export interface LogTimeInput {
  task_id: string;
  agent_id?: string;
  minutes: number;
  started_at?: string;
  ended_at?: string;
  notes?: string;
}

export function logTime(input: LogTimeInput, db?: Database): TaskTimeLog {
  const d = db || getDatabase();
  const id = uuid();
  const ts = now();
  d.run(
    `INSERT INTO task_time_logs (id, task_id, agent_id, minutes, started_at, ended_at, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.task_id, input.agent_id || null, input.minutes, input.started_at || null, input.ended_at || null, input.notes || null, ts],
  );
  return { id, task_id: input.task_id, agent_id: input.agent_id || null, minutes: input.minutes, started_at: input.started_at || null, ended_at: input.ended_at || null, notes: input.notes || null, created_at: ts };
}

export function getTimeLogs(taskId: string, db?: Database): TaskTimeLog[] {
  const d = db || getDatabase();
  return d.query(`SELECT * FROM task_time_logs WHERE task_id = ? ORDER BY created_at DESC`).all(taskId) as TaskTimeLog[];
}

export function getTimeReport(opts?: { project_id?: string; agent_id?: string; since?: string }, db?: Database): { task_id: string; title: string; estimated_minutes: number | null; actual_minutes: number | null; time_logs: TaskTimeLog[] }[] {
  const d = db || getDatabase();
  let query = `SELECT t.id as task_id, t.title, t.estimated_minutes, t.actual_minutes FROM tasks t WHERE t.status = 'completed'`;
  const params: any[] = [];
  if (opts?.project_id) { query += ` AND t.project_id = ?`; params.push(opts.project_id); }
  if (opts?.agent_id) { query += ` AND t.assigned_to = ?`; params.push(opts.agent_id); }
  if (opts?.since) { query += ` AND t.completed_at >= ?`; params.push(opts.since); }
  const rows = d.query(query).all(...params) as { task_id: string; title: string; estimated_minutes: number | null; actual_minutes: number | null }[];
  return rows.map(row => ({ ...row, time_logs: getTimeLogs(row.task_id, d) }));
}

// ── Task Watchers ──────────────────────────────────────────────────────────────

export function watchTask(taskId: string, agentId: string, db?: Database): TaskWatcher {
  const d = db || getDatabase();
  const id = uuid();
  const ts = now();
  d.run(
    `INSERT OR IGNORE INTO task_watchers (id, task_id, agent_id, created_at) VALUES (?, ?, ?, ?)`,
    [id, taskId, agentId, ts],
  );
  const existing = d.query(`SELECT * FROM task_watchers WHERE task_id = ? AND agent_id = ?`).get(taskId, agentId) as TaskWatcher;
  return existing;
}

export function unwatchTask(taskId: string, agentId: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run(`DELETE FROM task_watchers WHERE task_id = ? AND agent_id = ?`, [taskId, agentId]);
  return result.changes > 0;
}

export function getTaskWatchers(taskId: string, db?: Database): TaskWatcher[] {
  const d = db || getDatabase();
  return d.query(`SELECT * FROM task_watchers WHERE task_id = ?`).all(taskId) as TaskWatcher[];
}

export function notifyWatchers(taskId: string, event: string, data: Record<string, unknown>, db?: Database): void {
  const watchers = getTaskWatchers(taskId, db);
  // Dispatch webhook for each watcher event (actual notification via webhook/signal is external)
  dispatchWebhook(`task.watcher.${event}`, { task_id: taskId, watchers: watchers.map(w => w.agent_id), ...data }, db).catch(() => {});
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
