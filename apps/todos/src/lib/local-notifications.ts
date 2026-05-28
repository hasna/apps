import type { Database } from "bun:sqlite";
import { getDatabase, now } from "../db/database.js";
import { getEscalatedTasks, getStaleTasks, getTask, listCalendarEvents, listTasks } from "../db/tasks.js";
import { listTaskRuns } from "../db/task-runs.js";
import type { CalendarEvent, Task } from "../types/index.js";
import {
  emitLocalEventHooks,
  type LocalEventHookDispatchResult,
  type LocalEventType,
} from "./event-hooks.js";
import {
  evaluateTerminalWatchRules,
  type TerminalNotificationEvaluation,
} from "./terminal-notifications.js";
import { redactValue } from "./redaction.js";

export const LOCAL_NOTIFICATION_SCHEMA_VERSION = 1;

export type LocalNotificationKind =
  | "task_due"
  | "task_due_soon"
  | "task_sla"
  | "task_stale"
  | "run_completed"
  | "run_failed"
  | "calendar_reminder";

export type LocalNotificationSeverity = "info" | "warning" | "critical";

const SEVERITY_RANK: Record<LocalNotificationSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export interface LocalNotificationQuietHours {
  start: string;
  end: string;
  timezone?: "utc" | "local";
}

export interface CheckLocalNotificationsInput {
  project_id?: string;
  agent_id?: string;
  now?: string;
  due_within_minutes?: number;
  stale_minutes?: number;
  run_since?: string;
  include_runs?: boolean;
  include_calendar?: boolean;
  emit_hooks?: boolean;
  evaluate_terminal?: boolean;
  quiet_hours?: LocalNotificationQuietHours;
  limit?: number;
}

export interface LocalNotificationAlert {
  id: string;
  kind: LocalNotificationKind;
  event_type: LocalEventType;
  severity: LocalNotificationSeverity;
  title: string;
  message: string;
  task_id: string | null;
  run_id: string | null;
  project_id: string | null;
  agent_id: string | null;
  due_at: string | null;
  triggered_at: string;
  quieted: boolean;
  payload: Record<string, unknown>;
}

export interface CheckLocalNotificationsResult {
  schema_version: 1;
  local_only: true;
  checked_at: string;
  quiet_hours: LocalNotificationQuietHours | null;
  quiet_active: boolean;
  alerts: LocalNotificationAlert[];
  hook_results: LocalEventHookDispatchResult[];
  terminal_evaluations: TerminalNotificationEvaluation[];
  counts: Record<LocalNotificationKind, number>;
  warnings: string[];
}

function minutes(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}

function parseClock(value: string): number {
  const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error("quiet hours must use HH:MM-HH:MM");
  return Number(match[1]) * 60 + Number(match[2]);
}

function quietActive(quiet: LocalNotificationQuietHours | undefined, timestamp: string): boolean {
  if (!quiet) return false;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return false;
  const current = quiet.timezone === "utc"
    ? date.getUTCHours() * 60 + date.getUTCMinutes()
    : date.getHours() * 60 + date.getMinutes();
  const start = parseClock(quiet.start);
  const end = parseClock(quiet.end);
  if (start === end) return true;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function unfinished(task: Task): boolean {
  return !["completed", "cancelled", "failed"].includes(task.status);
}

function alertId(kind: LocalNotificationKind, id: string, suffix = ""): string {
  return `${kind}:${id}${suffix ? `:${suffix}` : ""}`;
}

function taskPayload(task: Task, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return redactValue({
    id: task.id,
    task_id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    project_id: task.project_id,
    agent_id: task.agent_id,
    assigned_to: task.assigned_to,
    due_at: task.due_at,
    ...extra,
  }) as Record<string, unknown>;
}

function taskAlert(
  task: Task,
  kind: LocalNotificationKind,
  eventType: LocalEventType,
  severity: LocalNotificationSeverity,
  message: string,
  triggeredAt: string,
  quieted: boolean,
  extra: Record<string, unknown> = {},
): LocalNotificationAlert {
  return {
    id: alertId(kind, task.id, String(extra["reason"] || "")),
    kind,
    event_type: eventType,
    severity,
    title: task.title,
    message,
    task_id: task.id,
    run_id: null,
    project_id: task.project_id,
    agent_id: task.agent_id || task.assigned_to,
    due_at: task.due_at,
    triggered_at: triggeredAt,
    quieted,
    payload: taskPayload(task, { severity, kind, ...extra }),
  };
}

function calendarAlert(event: CalendarEvent, triggeredAt: string, quieted: boolean): LocalNotificationAlert {
  return {
    id: alertId("calendar_reminder", event.id),
    kind: "calendar_reminder",
    event_type: "calendar.reminder",
    severity: event.kind === "milestone" ? "warning" : "info",
    title: event.title,
    message: `${event.kind}: ${event.title}`,
    task_id: event.task_id,
    run_id: event.run_id,
    project_id: event.project_id,
    agent_id: typeof event.metadata["agent_id"] === "string" ? event.metadata["agent_id"] : null,
    due_at: event.starts_at,
    triggered_at: triggeredAt,
    quieted,
    payload: redactValue({ ...event, severity: event.kind === "milestone" ? "warning" : "info" }) as Record<string, unknown>,
  };
}

function runAlerts(input: CheckLocalNotificationsInput, db: Database, checkedAt: string, quieted: boolean): LocalNotificationAlert[] {
  if (input.include_runs === false) return [];
  const since = Date.parse(input.run_since || new Date(Date.parse(checkedAt) - 24 * 60 * 60_000).toISOString());
  return listTaskRuns(undefined, db)
    .filter((run) => run.completed_at && Date.parse(run.completed_at) >= since)
    .map((run): LocalNotificationAlert | null => {
      const task = getTask(run.task_id, db);
      if (input.project_id && task?.project_id !== input.project_id) return null;
      if (input.agent_id && run.agent_id !== input.agent_id && task?.assigned_to !== input.agent_id) return null;
      const failed = ["failed", "cancelled"].includes(run.status);
      return {
        id: alertId(failed ? "run_failed" : "run_completed", run.id),
        kind: failed ? "run_failed" : "run_completed",
        event_type: failed ? "run.failed" : "run.completed",
        severity: failed ? "critical" : "info",
        title: run.title || task?.title || run.id.slice(0, 8),
        message: `${run.status}: ${run.title || task?.title || run.id.slice(0, 8)}`,
        task_id: run.task_id,
        run_id: run.id,
        project_id: task?.project_id || null,
        agent_id: run.agent_id || task?.assigned_to || null,
        due_at: null,
        triggered_at: run.completed_at || checkedAt,
        quieted,
        payload: redactValue({ ...run, task_title: task?.title, project_id: task?.project_id, severity: failed ? "critical" : "info" }) as Record<string, unknown>,
      } satisfies LocalNotificationAlert;
    })
    .filter((alert): alert is LocalNotificationAlert => alert !== null);
}

function countAlerts(alerts: LocalNotificationAlert[]): Record<LocalNotificationKind, number> {
  const counts: Record<LocalNotificationKind, number> = {
    task_due: 0,
    task_due_soon: 0,
    task_sla: 0,
    task_stale: 0,
    run_completed: 0,
    run_failed: 0,
    calendar_reminder: 0,
  };
  for (const alert of alerts) counts[alert.kind]++;
  return counts;
}

export async function checkLocalNotifications(input: CheckLocalNotificationsInput = {}, db?: Database): Promise<CheckLocalNotificationsResult> {
  const d = db || getDatabase();
  const checkedAt = input.now || now();
  const checkedMs = Date.parse(checkedAt);
  const dueWithin = minutes(input.due_within_minutes, 60);
  const staleMinutes = minutes(input.stale_minutes, 30);
  const quieted = quietActive(input.quiet_hours, checkedAt);
  const warnings: string[] = [];
  if (Number.isNaN(checkedMs)) warnings.push("Invalid check timestamp; due-soon window may be incomplete.");

  const alerts: LocalNotificationAlert[] = [];
  for (const escalation of getEscalatedTasks({ project_id: input.project_id, agent_id: input.agent_id }, d, new Date(checkedAt))) {
    for (const reason of escalation.reasons) {
      alerts.push(taskAlert(
        escalation.task,
        reason === "sla_breached" ? "task_sla" : "task_due",
        reason === "sla_breached" ? "task.sla_breached" : "task.due",
        "critical",
        reason === "sla_breached" ? `SLA breached: ${escalation.task.title}` : `Overdue: ${escalation.task.title}`,
        escalation.breached_at,
        quieted,
        { reason },
      ));
    }
  }

  const dueSoonUntil = new Date(checkedMs + dueWithin * 60_000).toISOString();
  if (Number.isFinite(checkedMs) && dueWithin > 0) {
    for (const task of listTasks({ project_id: input.project_id, include_archived: false, limit: 5000 }, d)) {
      if (!unfinished(task) || !task.due_at) continue;
      if (input.agent_id && task.assigned_to !== input.agent_id && task.agent_id !== input.agent_id) continue;
      if (task.due_at > checkedAt && task.due_at <= dueSoonUntil) {
        alerts.push(taskAlert(task, "task_due_soon", "task.due_soon", "warning", `Due soon: ${task.title}`, task.due_at, quieted));
      }
    }
  }

  for (const task of getStaleTasks(staleMinutes, { project_id: input.project_id }, d)) {
    if (input.agent_id && task.assigned_to !== input.agent_id && task.agent_id !== input.agent_id) continue;
    alerts.push(taskAlert(task, "task_stale", "task.stale", "warning", `Stale task: ${task.title}`, checkedAt, quieted, { stale_minutes: staleMinutes }));
  }

  if (input.include_calendar !== false) {
    const to = Number.isFinite(checkedMs) ? new Date(checkedMs + dueWithin * 60_000).toISOString() : undefined;
    const events = listCalendarEvents({
      project_id: input.project_id,
      from: checkedAt,
      to,
      include_runs: false,
      include_sla: false,
      include_completed: true,
      limit: input.limit || 100,
    }, d).filter((event) => ["task_reminder", "milestone", "work_block"].includes(event.kind));
    alerts.push(...events.map((event) => calendarAlert(event, checkedAt, quieted)));
  }

  alerts.push(...runAlerts(input, d, checkedAt, quieted));
  const limited = alerts
    .sort((left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] || left.triggered_at.localeCompare(right.triggered_at) || left.id.localeCompare(right.id))
    .slice(0, input.limit || 100);

  const hookResults: LocalEventHookDispatchResult[] = [];
  const terminalEvaluations: TerminalNotificationEvaluation[] = [];
  if (!quieted) {
    for (const alert of limited) {
      if (input.emit_hooks) hookResults.push(...await emitLocalEventHooks({ type: alert.event_type, payload: alert.payload, timestamp: checkedAt }));
      if (input.evaluate_terminal) terminalEvaluations.push(...evaluateTerminalWatchRules({ type: alert.event_type, payload: alert.payload, timestamp: checkedAt }));
    }
  }

  return {
    schema_version: LOCAL_NOTIFICATION_SCHEMA_VERSION,
    local_only: true,
    checked_at: checkedAt,
    quiet_hours: input.quiet_hours || null,
    quiet_active: quieted,
    alerts: limited,
    hook_results: hookResults,
    terminal_evaluations: terminalEvaluations,
    counts: countAlerts(limited),
    warnings,
  };
}
