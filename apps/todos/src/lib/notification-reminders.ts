/**
 * Local-only notification reminders — due-date alerts, SLA warnings, custom reminders.
 * Stored in SQLite; optional desktop notify-send when enabled.
 */

import { execSync } from "node:child_process";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { getDatabase, now, uuid } from "../db/database.js";
import { getTask, listTasks, type Task } from "../db/tasks.js";
import { rowToTask } from "../db/task-crud.js";
import { getOverdueTasks } from "../db/task-relations.js";
import type { TaskRow } from "../types/index.js";

export const NOTIFICATION_REMINDERS_SCHEMA = "todos.notification_reminders.v1";

export const REMINDER_TYPES = ["due_soon", "due_overdue", "sla_warning", "sla_breach", "custom"] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

export const REMINDER_STATUSES = ["pending", "fired", "dismissed", "snoozed"] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export interface ReminderPreferences {
  schema_version: typeof NOTIFICATION_REMINDERS_SCHEMA;
  due_soon_hours: number;
  sla_warning_minutes: number;
  enabled: boolean;
  desktop_notify: boolean;
  updated_at: string;
}

export interface NotificationReminder {
  schema_version: typeof NOTIFICATION_REMINDERS_SCHEMA;
  id: string;
  task_id: string | null;
  reminder_type: ReminderType;
  title: string;
  message: string | null;
  trigger_at: string;
  status: ReminderStatus;
  snoozed_until: string | null;
  project_id: string | null;
  agent_id: string | null;
  priority: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  fired_at: string | null;
  dismissed_at: string | null;
}

export interface ScanRemindersResult {
  schema_version: typeof NOTIFICATION_REMINDERS_SCHEMA;
  created: number;
  updated: number;
  dismissed: number;
  reminders: NotificationReminder[];
}

export interface ProcessRemindersResult {
  schema_version: typeof NOTIFICATION_REMINDERS_SCHEMA;
  fired: number;
  reminders: NotificationReminder[];
  desktop_notifications_sent: number;
}

export interface ReminderSummary {
  schema_version: typeof NOTIFICATION_REMINDERS_SCHEMA;
  pending: number;
  due_now: number;
  snoozed: number;
  fired_today: number;
  by_type: Record<string, number>;
}

export interface CreateReminderInput {
  task_id?: string;
  reminder_type?: ReminderType;
  title: string;
  message?: string;
  trigger_at: string;
  project_id?: string;
  agent_id?: string;
  priority?: string;
  metadata?: Record<string, unknown>;
}

const DEFAULT_PREFS: Omit<ReminderPreferences, "updated_at"> = {
  schema_version: NOTIFICATION_REMINDERS_SCHEMA,
  due_soon_hours: 24,
  sla_warning_minutes: 30,
  enabled: true,
  desktop_notify: false,
};

function rowToReminder(row: Record<string, unknown>): NotificationReminder {
  return {
    schema_version: NOTIFICATION_REMINDERS_SCHEMA,
    id: row.id as string,
    task_id: (row.task_id as string | null) ?? null,
    reminder_type: row.reminder_type as ReminderType,
    title: row.title as string,
    message: (row.message as string | null) ?? null,
    trigger_at: row.trigger_at as string,
    status: row.status as ReminderStatus,
    snoozed_until: (row.snoozed_until as string | null) ?? null,
    project_id: (row.project_id as string | null) ?? null,
    agent_id: (row.agent_id as string | null) ?? null,
    priority: row.priority as string,
    metadata: JSON.parse((row.metadata as string) || "{}"),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    fired_at: (row.fired_at as string | null) ?? null,
    dismissed_at: (row.dismissed_at as string | null) ?? null,
  };
}

function activeStatusesSql(): string {
  return "('pending', 'snoozed')";
}

function findActiveReminder(
  taskId: string | null,
  reminderType: ReminderType,
  d: Database,
): NotificationReminder | null {
  const row = d
    .query(
      `SELECT * FROM notification_reminders
       WHERE task_id IS ? AND reminder_type = ? AND status IN ${activeStatusesSql()}
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(taskId, reminderType) as Record<string, unknown> | null;
  return row ? rowToReminder(row) : null;
}

function upsertAutoReminder(
  input: {
    task_id: string;
    reminder_type: ReminderType;
    title: string;
    message: string;
    trigger_at: string;
    project_id: string | null;
    agent_id: string | null;
    priority: string;
    metadata?: Record<string, unknown>;
  },
  d: Database,
): { reminder: NotificationReminder; created: boolean } {
  const existing = findActiveReminder(input.task_id, input.reminder_type, d);
  const ts = now();

  if (existing) {
    d.run(
      `UPDATE notification_reminders
       SET title = ?, message = ?, trigger_at = ?, project_id = ?, agent_id = ?, priority = ?, metadata = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.title,
        input.message,
        input.trigger_at,
        input.project_id,
        input.agent_id,
        input.priority,
        JSON.stringify(input.metadata ?? {}),
        ts,
        existing.id,
      ],
    );
    return { reminder: getReminder(existing.id, d)!, created: false };
  }

  const id = uuid();
  d.run(
    `INSERT INTO notification_reminders
     (id, task_id, reminder_type, title, message, trigger_at, status, project_id, agent_id, priority, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.task_id,
      input.reminder_type,
      input.title,
      input.message,
      input.trigger_at,
      input.project_id,
      input.agent_id,
      input.priority,
      JSON.stringify(input.metadata ?? {}),
      ts,
      ts,
    ],
  );
  return { reminder: getReminder(id, d)!, created: true };
}

export function getReminderPreferences(db?: Database): ReminderPreferences {
  const d = getDatabase(db);
  const row = d.query("SELECT * FROM reminder_preferences WHERE id = 'default'").get() as Record<string, unknown> | null;
  if (!row) {
    return { ...DEFAULT_PREFS, updated_at: now() };
  }
  return {
    schema_version: NOTIFICATION_REMINDERS_SCHEMA,
    due_soon_hours: row.due_soon_hours as number,
    sla_warning_minutes: row.sla_warning_minutes as number,
    enabled: !!(row.enabled as number),
    desktop_notify: !!(row.desktop_notify as number),
    updated_at: row.updated_at as string,
  };
}

export function setReminderPreferences(
  input: Partial<Omit<ReminderPreferences, "schema_version" | "updated_at">>,
  db?: Database,
): ReminderPreferences {
  const d = getDatabase(db);
  const current = getReminderPreferences(d);
  const next = {
    due_soon_hours: input.due_soon_hours ?? current.due_soon_hours,
    sla_warning_minutes: input.sla_warning_minutes ?? current.sla_warning_minutes,
    enabled: input.enabled ?? current.enabled,
    desktop_notify: input.desktop_notify ?? current.desktop_notify,
    updated_at: now(),
  };

  d.run(
    `INSERT INTO reminder_preferences (id, due_soon_hours, sla_warning_minutes, enabled, desktop_notify, updated_at)
     VALUES ('default', ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       due_soon_hours = excluded.due_soon_hours,
       sla_warning_minutes = excluded.sla_warning_minutes,
       enabled = excluded.enabled,
       desktop_notify = excluded.desktop_notify,
       updated_at = excluded.updated_at`,
    [
      next.due_soon_hours,
      next.sla_warning_minutes,
      next.enabled ? 1 : 0,
      next.desktop_notify ? 1 : 0,
      next.updated_at,
    ],
  );

  return getReminderPreferences(d);
}

export function createReminder(input: CreateReminderInput, db?: Database): NotificationReminder {
  const d = getDatabase(db);
  const ts = now();
  const id = uuid();
  let projectId = input.project_id ?? null;
  let agentId = input.agent_id ?? null;

  if (input.task_id) {
    const task = getTask(input.task_id, d);
    if (!task) throw new Error(`Task not found: ${input.task_id}`);
    projectId = projectId ?? task.project_id;
    agentId = agentId ?? task.assigned_to;
  }

  d.run(
    `INSERT INTO notification_reminders
     (id, task_id, reminder_type, title, message, trigger_at, status, project_id, agent_id, priority, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.task_id ?? null,
      input.reminder_type ?? "custom",
      input.title,
      input.message ?? null,
      input.trigger_at,
      projectId,
      agentId,
      input.priority ?? "medium",
      JSON.stringify(input.metadata ?? {}),
      ts,
      ts,
    ],
  );

  return getReminder(id, d)!;
}

export function getReminder(id: string, db?: Database): NotificationReminder | null {
  const d = getDatabase(db);
  const row = d.query("SELECT * FROM notification_reminders WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? rowToReminder(row) : null;
}

export function listReminders(
  filters: {
    status?: ReminderStatus | ReminderStatus[];
    reminder_type?: ReminderType;
    project_id?: string;
    agent_id?: string;
    task_id?: string;
    limit?: number;
  } = {},
  db?: Database,
): NotificationReminder[] {
  const d = getDatabase(db);
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (filters.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
    params.push(...statuses);
  }
  if (filters.reminder_type) {
    conditions.push("reminder_type = ?");
    params.push(filters.reminder_type);
  }
  if (filters.project_id) {
    conditions.push("project_id = ?");
    params.push(filters.project_id);
  }
  if (filters.agent_id) {
    conditions.push("agent_id = ?");
    params.push(filters.agent_id);
  }
  if (filters.task_id) {
    conditions.push("task_id = ?");
    params.push(filters.task_id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit ?? 100;
  const rows = d
    .query(`SELECT * FROM notification_reminders ${where} ORDER BY trigger_at ASC LIMIT ?`)
    .all(...params, limit) as Record<string, unknown>[];
  return rows.map(rowToReminder);
}

export function dismissReminder(id: string, db?: Database): NotificationReminder | null {
  const d = getDatabase(db);
  const ts = now();
  d.run(
    `UPDATE notification_reminders SET status = 'dismissed', dismissed_at = ?, updated_at = ? WHERE id = ?`,
    [ts, ts, id],
  );
  return getReminder(id, d);
}

export function snoozeReminder(id: string, until: string, db?: Database): NotificationReminder | null {
  const d = getDatabase(db);
  const ts = now();
  d.run(
    `UPDATE notification_reminders SET status = 'snoozed', snoozed_until = ?, trigger_at = ?, updated_at = ? WHERE id = ?`,
    [until, until, ts, id],
  );
  return getReminder(id, d);
}

export function getUpcomingDueTasks(
  filters: { hours?: number; project_id?: string; agent_id?: string } = {},
  db?: Database,
): Task[] {
  const d = getDatabase(db);
  const hours = filters.hours ?? 24;
  const nowDate = new Date();
  const horizon = new Date(nowDate.getTime() + hours * 3600000).toISOString();
  const nowStr = nowDate.toISOString();

  let query = `SELECT * FROM tasks
    WHERE due_at IS NOT NULL AND due_at >= ? AND due_at <= ?
    AND status NOT IN ('completed', 'cancelled', 'failed', 'archived')`;
  const params: SQLQueryBindings[] = [nowStr, horizon];

  if (filters.project_id) {
    query += " AND project_id = ?";
    params.push(filters.project_id);
  }
  if (filters.agent_id) {
    query += " AND assigned_to = ?";
    params.push(filters.agent_id);
  }
  query += " ORDER BY due_at ASC";

  const rows = d.query(query).all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => rowToTask(row as unknown as TaskRow));
}

/** Backward-compatible alias used by notify_upcoming_deadlines MCP tool. */
export function notifyUpcomingDeadlines(
  filters: { hours?: number; project_id?: string; agent_id?: string } = {},
  db?: Database,
): Task[] {
  return getUpcomingDueTasks(filters, db);
}

function dismissRemindersForInactiveTasks(d: Database): number {
  const result = d.run(
    `UPDATE notification_reminders
     SET status = 'dismissed', dismissed_at = ?, updated_at = ?
     WHERE status IN ${activeStatusesSql()}
       AND task_id IS NOT NULL
       AND task_id IN (
         SELECT id FROM tasks WHERE status IN ('completed', 'cancelled', 'failed', 'archived')
       )`,
    [now(), now()],
  );
  return result.changes;
}

function scanDueDateReminders(
  prefs: ReminderPreferences,
  filters: { project_id?: string; agent_id?: string },
  d: Database,
): { created: number; updated: number; reminders: NotificationReminder[] } {
  let created = 0;
  let updated = 0;
  const reminders: NotificationReminder[] = [];

  const upcoming = getUpcomingDueTasks(
    { hours: prefs.due_soon_hours, project_id: filters.project_id, agent_id: filters.agent_id },
    d,
  );
  for (const task of upcoming) {
    const label = task.short_id ? `${task.short_id} ${task.title}` : task.title;
    const result = upsertAutoReminder(
      {
        task_id: task.id,
        reminder_type: "due_soon",
        title: `Due soon: ${label}`,
        message: `Task due at ${task.due_at}`,
        trigger_at: task.due_at!,
        project_id: task.project_id,
        agent_id: task.assigned_to,
        priority: task.priority,
        metadata: { due_at: task.due_at },
      },
      d,
    );
    if (result.created) created++;
    else updated++;
    reminders.push(result.reminder);
  }

  const overdue = getOverdueTasks(filters.project_id, d).filter((t) => {
    if (filters.agent_id && t.assigned_to !== filters.agent_id) return false;
    return true;
  });
  for (const task of overdue) {
    const label = task.short_id ? `${task.short_id} ${task.title}` : task.title;
    const result = upsertAutoReminder(
      {
        task_id: task.id,
        reminder_type: "due_overdue",
        title: `Overdue: ${label}`,
        message: `Task was due at ${task.due_at}`,
        trigger_at: task.due_at!,
        project_id: task.project_id,
        agent_id: task.assigned_to,
        priority: "high",
        metadata: { due_at: task.due_at },
      },
      d,
    );
    if (result.created) created++;
    else updated++;
    reminders.push(result.reminder);
  }

  return { created, updated, reminders };
}

function scanSlaReminders(
  prefs: ReminderPreferences,
  filters: { project_id?: string; agent_id?: string },
  d: Database,
): { created: number; updated: number; reminders: NotificationReminder[] } {
  let created = 0;
  let updated = 0;
  const reminders: NotificationReminder[] = [];
  const ts = Date.now();

  const tasks = listTasks(
    { status: "in_progress", project_id: filters.project_id, assigned_to: filters.agent_id, limit: 500 },
    d,
  );

  for (const task of tasks) {
    if (!task.sla_minutes || !task.started_at) continue;

    const slaDeadline = new Date(task.started_at).getTime() + task.sla_minutes * 60000;
    const warningAt = slaDeadline - prefs.sla_warning_minutes * 60000;
    const label = task.short_id ? `${task.short_id} ${task.title}` : task.title;

    if (ts >= warningAt && ts < slaDeadline) {
      const result = upsertAutoReminder(
        {
          task_id: task.id,
          reminder_type: "sla_warning",
          title: `SLA warning: ${label}`,
          message: `SLA breach in ${Math.ceil((slaDeadline - ts) / 60000)} minutes`,
          trigger_at: new Date(warningAt).toISOString(),
          project_id: task.project_id,
          agent_id: task.assigned_to,
          priority: "high",
          metadata: { sla_minutes: task.sla_minutes, sla_deadline: new Date(slaDeadline).toISOString() },
        },
        d,
      );
      if (result.created) created++;
      else updated++;
      reminders.push(result.reminder);
    }

    if (ts >= slaDeadline) {
      const result = upsertAutoReminder(
        {
          task_id: task.id,
          reminder_type: "sla_breach",
          title: `SLA breached: ${label}`,
          message: `Task exceeded SLA of ${task.sla_minutes} minutes`,
          trigger_at: new Date(slaDeadline).toISOString(),
          project_id: task.project_id,
          agent_id: task.assigned_to,
          priority: "critical",
          metadata: { sla_minutes: task.sla_minutes, sla_deadline: new Date(slaDeadline).toISOString() },
        },
        d,
      );
      if (result.created) created++;
      else updated++;
      reminders.push(result.reminder);
    }
  }

  return { created, updated, reminders };
}

export function scanReminders(
  filters: { project_id?: string; agent_id?: string } = {},
  db?: Database,
): ScanRemindersResult {
  const d = getDatabase(db);
  const prefs = getReminderPreferences(d);
  if (!prefs.enabled) {
    return { schema_version: NOTIFICATION_REMINDERS_SCHEMA, created: 0, updated: 0, dismissed: 0, reminders: [] };
  }

  const dismissed = dismissRemindersForInactiveTasks(d);
  const due = scanDueDateReminders(prefs, filters, d);
  const sla = scanSlaReminders(prefs, filters, d);

  return {
    schema_version: NOTIFICATION_REMINDERS_SCHEMA,
    created: due.created + sla.created,
    updated: due.updated + sla.updated,
    dismissed,
    reminders: [...due.reminders, ...sla.reminders],
  };
}

function sendDesktopNotification(title: string, message: string): boolean {
  try {
    execSync(`notify-send ${JSON.stringify(title)} ${JSON.stringify(message)}`, {
      stdio: "ignore",
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

export function processDueReminders(
  options: { desktop?: boolean; project_id?: string; agent_id?: string } = {},
  db?: Database,
): ProcessRemindersResult {
  const d = getDatabase(db);
  const prefs = getReminderPreferences(d);
  const ts = now();
  const dueReminders = listReminders({ status: ["pending", "snoozed"], limit: 500 }, d).filter((r) => {
    if (r.trigger_at > ts) return false;
    if (r.status === "snoozed" && r.snoozed_until && r.snoozed_until > ts) return false;
    if (options.project_id && r.project_id !== options.project_id) return false;
    if (options.agent_id && r.agent_id !== options.agent_id) return false;
    return true;
  });

  let desktopSent = 0;
  const fired: NotificationReminder[] = [];
  const useDesktop = options.desktop ?? prefs.desktop_notify;

  for (const reminder of dueReminders) {
    d.run(
      `UPDATE notification_reminders SET status = 'fired', fired_at = ?, updated_at = ? WHERE id = ?`,
      [ts, ts, reminder.id],
    );
    const updated = getReminder(reminder.id, d)!;
    fired.push(updated);
    if (useDesktop && sendDesktopNotification(updated.title, updated.message ?? updated.title)) {
      desktopSent++;
    }
  }

  return {
    schema_version: NOTIFICATION_REMINDERS_SCHEMA,
    fired: fired.length,
    reminders: fired,
    desktop_notifications_sent: desktopSent,
  };
}

export function getReminderSummary(db?: Database): ReminderSummary {
  const d = getDatabase(db);
  const ts = now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const pending = (d.query("SELECT COUNT(*) as c FROM notification_reminders WHERE status = 'pending'").get() as { c: number }).c;
  const snoozed = (d.query("SELECT COUNT(*) as c FROM notification_reminders WHERE status = 'snoozed'").get() as { c: number }).c;
  const dueNow = (
    d.query(
      `SELECT COUNT(*) as c FROM notification_reminders
       WHERE status IN ('pending', 'snoozed') AND trigger_at <= ?`,
    ).get(ts) as { c: number }
  ).c;
  const firedToday = (
    d.query("SELECT COUNT(*) as c FROM notification_reminders WHERE status = 'fired' AND fired_at >= ?").get(todayStart.toISOString()) as {
      c: number;
    }
  ).c;

  const typeRows = d
    .query(
      `SELECT reminder_type, COUNT(*) as c FROM notification_reminders
       WHERE status IN ('pending', 'snoozed') GROUP BY reminder_type`,
    )
    .all() as { reminder_type: string; c: number }[];
  const by_type: Record<string, number> = {};
  for (const row of typeRows) by_type[row.reminder_type] = row.c;

  return {
    schema_version: NOTIFICATION_REMINDERS_SCHEMA,
    pending,
    due_now: dueNow,
    snoozed,
    fired_today: firedToday,
    by_type,
  };
}

export function getReminderDocs(): string {
  return [
    "Local notification reminders (offline, SQLite-backed)",
    "",
    "Types: due_soon, due_overdue, sla_warning, sla_breach, custom",
    "",
    "Workflow:",
    "  1. todos reminders scan       — sync reminders from due dates + SLA",
    "  2. todos reminders check      — fire due reminders (optional notify-send)",
    "  3. todos reminders dismiss    — dismiss a reminder",
    "  4. todos reminders snooze     — snooze until a later time",
    "",
    "Preferences: todos reminders prefs --due-soon-hours 24 --sla-warning-minutes 30",
  ].join("\n");
}
