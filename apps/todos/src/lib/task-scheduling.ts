/**
 * Local task scheduling — due dates, delayed starts, recurrence helpers,
 * stale detection, and agent-safe queue ordering.
 */

import type { Database } from "bun:sqlite";
import { getDatabase, now } from "../db/database.js";
import { getTask, listTasks, type Task } from "../db/tasks.js";
import { getNextTask, getStaleTasks, claimNextTask } from "../db/tasks.js";
import { getOverdueTasks } from "../db/task-relations.js";
import { parseRecurrenceRule, nextOccurrence, isValidRecurrenceRule } from "./recurrence.js";
import { logTaskChange } from "../db/audit.js";

export const TASK_SCHEDULING_SCHEMA = "todos.task_scheduling.v1";

export interface ScheduleTaskInput {
  due_at?: string | null;
  scheduled_start_at?: string | null;
  recurrence_rule?: string | null;
}

export interface StaleTaskReport {
  schema_version: typeof TASK_SCHEDULING_SCHEMA;
  stale_minutes: number;
  count: number;
  tasks: Array<{
    id: string;
    short_id: string | null;
    title: string;
    assigned_to: string | null;
    locked_by: string | null;
    stale_minutes: number;
    updated_at: string;
  }>;
}

export interface SchedulingQueueItem {
  id: string;
  short_id: string | null;
  title: string;
  priority: string;
  due_at: string | null;
  scheduled_start_at: string | null;
  score: number;
  blocked: boolean;
}

export interface SchedulingSummary {
  schema_version: typeof TASK_SCHEDULING_SCHEMA;
  due_today: number;
  overdue: number;
  stale: number;
  waiting_delayed_start: number;
  recurring: number;
  next_claimable: Task | null;
}

function priorityScore(priority: string): number {
  return { critical: 0, high: 1, medium: 2, low: 3 }[priority] ?? 9;
}

function dueUrgencyScore(dueAt: string | null, ts: number): number {
  if (!dueAt) return 50;
  const diff = new Date(dueAt).getTime() - ts;
  if (diff < 0) return 0; // overdue — highest urgency
  if (diff < 86400000) return 10; // due within 24h
  if (diff < 86400000 * 7) return 20;
  return 40;
}

export function scheduleTask(taskId: string, input: ScheduleTaskInput, db?: Database): Task {
  const d = db || getDatabase();
  const task = getTask(taskId, d);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  if (input.recurrence_rule && !isValidRecurrenceRule(input.recurrence_rule)) {
    throw new Error(`Invalid recurrence rule: ${input.recurrence_rule}`);
  }

  const ts = now();
  const dueAt = input.due_at !== undefined ? input.due_at : task.due_at;
  const startAt = input.scheduled_start_at !== undefined ? input.scheduled_start_at : (task as Task & { scheduled_start_at?: string | null }).scheduled_start_at ?? null;
  const recurrence = input.recurrence_rule !== undefined ? input.recurrence_rule : task.recurrence_rule;

  d.run(
    `UPDATE tasks SET due_at = ?, scheduled_start_at = ?, recurrence_rule = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
    [dueAt, startAt, recurrence, ts, taskId],
  );

  if (input.due_at !== undefined && input.due_at !== task.due_at) {
    logTaskChange(taskId, "schedule", "due_at", task.due_at, input.due_at ?? null, null, d);
  }
  if (input.scheduled_start_at !== undefined) {
    logTaskChange(taskId, "schedule", "scheduled_start_at", null, input.scheduled_start_at ?? null, null, d);
  }

  return getTask(taskId, d)!;
}

export function listDelayedStartTasks(db?: Database): Task[] {
  const d = db || getDatabase();
  const ts = now();
  return listTasks({ status: "pending", limit: 500 }, d).filter((t) => {
    const start = (t as Task & { scheduled_start_at?: string | null }).scheduled_start_at;
    return start && start > ts;
  });
}

export function listReadyScheduledTasks(filters: { project_id?: string } = {}, db?: Database): Task[] {
  const d = db || getDatabase();
  const ts = now();
  const tasks = listTasks({ status: "pending", project_id: filters.project_id, limit: 500 }, d);
  return tasks.filter((t) => {
    const start = (t as Task & { scheduled_start_at?: string | null }).scheduled_start_at;
    return !start || start <= ts;
  });
}

export function getAgentSafeQueue(
  _agentId?: string,
  filters: { project_id?: string; limit?: number } = {},
  db?: Database,
): SchedulingQueueItem[] {
  const d = db || getDatabase();
  const ts = Date.now();
  const ready = listReadyScheduledTasks({ project_id: filters.project_id }, d);

  const items: SchedulingQueueItem[] = ready.map((t) => {
    const start = (t as Task & { scheduled_start_at?: string | null }).scheduled_start_at ?? null;
    const score = priorityScore(t.priority) * 100 + dueUrgencyScore(t.due_at, ts);
    return {
      id: t.id,
      short_id: t.short_id,
      title: t.title,
      priority: t.priority,
      due_at: t.due_at,
      scheduled_start_at: start,
      score,
      blocked: false,
    };
  });

  items.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return items.slice(0, filters.limit ?? 20);
}

export function getStaleTaskReport(staleMinutes = 30, filters?: { project_id?: string }, db?: Database): StaleTaskReport {
  const stale = getStaleTasks(staleMinutes, filters, db);
  const ts = Date.now();
  return {
    schema_version: TASK_SCHEDULING_SCHEMA,
    stale_minutes: staleMinutes,
    count: stale.length,
    tasks: stale.map((t) => ({
      id: t.id,
      short_id: t.short_id,
      title: t.title,
      assigned_to: t.assigned_to,
      locked_by: t.locked_by,
      stale_minutes: Math.round((ts - new Date(t.updated_at).getTime()) / 60000),
      updated_at: t.updated_at,
    })),
  };
}

export function getSchedulingSummary(
  agentId?: string,
  filters?: { project_id?: string },
  db?: Database,
): SchedulingSummary {
  const d = db || getDatabase();
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const pending = listTasks({ status: "pending", project_id: filters?.project_id, limit: 1000 }, d);
  const dueToday = pending.filter((t) => t.due_at && t.due_at >= todayStart.toISOString() && t.due_at <= todayEnd.toISOString()).length;
  const overdue = getOverdueTasks(filters?.project_id, d).length;
  const stale = getStaleTasks(30, filters, d).length;
  const waiting = listDelayedStartTasks(d).length;
  const recurring = pending.filter((t) => t.recurrence_rule).length;
  const next = getNextTask(agentId, filters, d);

  return {
    schema_version: TASK_SCHEDULING_SCHEMA,
    due_today: dueToday,
    overdue,
    stale,
    waiting_delayed_start: waiting,
    recurring,
    next_claimable: next,
  };
}

export function previewNextRecurrence(taskId: string, db?: Database): { due_at: string; rule: string } | null {
  const task = getTask(taskId, db);
  if (!task?.recurrence_rule) return null;
  parseRecurrenceRule(task.recurrence_rule);
  const base = task.due_at ? new Date(task.due_at) : new Date();
  return { rule: task.recurrence_rule, due_at: nextOccurrence(task.recurrence_rule, base) };
}

export function agentClaimNextSafe(agentId: string, filters?: { project_id?: string }, db?: Database): Task | null {
  return claimNextTask(agentId, filters, db);
}

export function getAgentLoopDocs(): string {
  return `# Agent scheduling loop (local-only)

## Recommended loop

\`\`\`bash
todos schedule summary --agent <name>
todos claim <name>          # or: todos schedule claim <name>
todos log-progress <id> "..."
todos done <id> --commit-hash HEAD
todos stale --minutes 30    # recover abandoned work
\`\`\`

## MCP equivalents

- \`get_scheduling_summary\` — due/overdue/stale counts + next claimable
- \`get_agent_safe_queue\` — ordered pending tasks respecting delayed starts
- \`get_stale_task_report\` — stale in_progress tasks
- \`schedule_task\` — set due_at, scheduled_start_at, recurrence_rule
- \`claim_next_task\` — atomic claim (existing)

## Ordering rules

1. Exclude tasks with \`scheduled_start_at\` in the future
2. Prefer overdue and due-soon tasks
3. Then priority: critical → high → medium → low
4. Exclude dependency-blocked tasks (via \`getNextTask\`)

## Recurrence

Rules: \`every day\`, \`every weekday\`, \`every 2 weeks\`, \`every monday\`, etc.
Completing a recurring task spawns the next instance automatically.
`;
}
