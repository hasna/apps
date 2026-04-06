import type { Database, SQLQueryBindings } from "bun:sqlite";
import type {
  LockResult,
  Task,
  TaskRow,
} from "../types/index.js";
import {
  LockError,
  TaskNotFoundError,
  VersionConflictError,
} from "../types/index.js";
import { clearExpiredLocks, getDatabase, isLockExpired, lockExpiryCutoff, now } from "./database.js";
import { checkCompletionGuard } from "../lib/completion-guard.js";
import { logTaskChange } from "./audit.js";
import { nextOccurrence } from "../lib/recurrence.js";
import { dispatchWebhook } from "./webhooks.js";
import { taskFromTemplate } from "./templates.js";
import { createTask, getTask, rowToTask } from "./task-crud.js";
import { getTaskDependencies } from "./task-graph.js";

// Maximum depth for template-spawned task chains to prevent infinite loops
const MAX_SPAWN_DEPTH = 10;

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

  const timestamp = now();
  const confidence = options?.confidence !== undefined ? options.confidence : null;

  // Perform both updates atomically in a transaction with optimistic locking
  const tx = d.transaction(() => {
    if (hasMeta) {
      const meta = { ...task.metadata, ...completionMeta };
      const metaResult = d.run(
        "UPDATE tasks SET metadata = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
        [JSON.stringify(meta), timestamp, id, task.version],
      );
      if (metaResult.changes === 0) {
        const current = getTask(id, d);
        throw new VersionConflictError(id, task.version, current?.version ?? -1);
      }
    }

    d.run(
      `UPDATE tasks SET status = 'completed', locked_by = NULL, locked_at = NULL, completed_at = ?, confidence = ?, version = version + 1, updated_at = ?
       WHERE id = ?`,
      [timestamp, confidence, timestamp, id],
    );
  });

  tx();

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
    // Prevent infinite spawn chains: track depth via metadata
    const spawnDepth = (task.metadata as Record<string, unknown> | null)?._spawn_depth as number || 0;
    if (spawnDepth >= MAX_SPAWN_DEPTH) {
      console.warn(`[tasks] Task ${id} exceeded max spawn depth (${MAX_SPAWN_DEPTH}), skipping template spawn`);
    } else {
      try {
        const input = taskFromTemplate(task.spawns_template_id, {
          project_id: task.project_id ?? undefined,
          plan_id: task.plan_id ?? undefined,
          task_list_id: task.task_list_id ?? undefined,
          assigned_to: task.assigned_to ?? undefined,
        }, d);
        // Set spawn depth on the new task
        input.metadata = { ...(input.metadata || {}), _spawn_depth: spawnDepth + 1 };
        spawnedFromTemplate = createTask(input, d);
      } catch {
        // Template may have been deleted; skip silently
      }
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

// Internal helper — spawn next recurring task

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
