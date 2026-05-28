import type { Database, SQLQueryBindings } from "bun:sqlite";
import type {
  Task,
  TaskPriority,
  TaskStatus,
} from "../types/index.js";
import {
  TaskNotFoundError,
  VersionConflictError,
} from "../types/index.js";
import { getDatabase, now } from "./database.js";
import { countTasks, createTask, getTask, listTasks, updateTask } from "./task-crud.js";
import { addDependency } from "./task-graph.js";
import {
  claimNextTask,
  getActiveWork,
  getBlockingDeps,
  getNextTask,
  getStaleTasks,
} from "./task-lifecycle.js";

export interface StatusSummary {
  pending: number;
  in_progress: number;
  completed: number;
  total: number;
  active_work: import("./task-lifecycle.js").ActiveWorkItem[];
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
