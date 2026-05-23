/**
 * Local terminal notifications and watch rules for task/plan/run/approval events.
 * SQLite-backed; optional bell, notify-send, and shell hooks. No hosted push dependency.
 */

import { execSync } from "node:child_process";
import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "../db/database.js";
import { getTask, type Task } from "../db/tasks.js";
import { getStaleTasks } from "../db/task-lifecycle.js";
import { getOverdueTasks } from "../db/task-relations.js";
import { listActivity, type ActivityRecord } from "./activity-audit.js";
import { getUpcomingDueTasks } from "./notification-reminders.js";
import { loadConfig, type WatchRulePattern } from "./config.js";
import { getProject } from "../db/projects.js";

export const TERMINAL_NOTIFICATIONS_SCHEMA = "todos.terminal_notifications.v1";

export const WATCH_EVENT_TYPES = [
  "task.created",
  "task.started",
  "task.completed",
  "task.failed",
  "task.assigned",
  "task.status_changed",
  "task.due_soon",
  "task.due_overdue",
  "task.stale",
  "task.stale_lock",
  "plan.updated",
  "plan.completed",
  "run.started",
  "run.completed",
  "run.failed",
  "approval.pending",
  "approval.approved",
  "approval.rejected",
  "check.failed",
] as const;

export type WatchEventType = (typeof WATCH_EVENT_TYPES)[number];

export type WatchSeverity = "info" | "warn" | "error";

export interface WatchEvent {
  schema_version: typeof TERMINAL_NOTIFICATIONS_SCHEMA;
  id: string;
  event: WatchEventType;
  entity_type: "task" | "plan" | "run_record" | "approval" | "check";
  entity_id: string;
  title: string;
  message: string | null;
  project_id: string | null;
  agent_id: string | null;
  severity: WatchSeverity;
  occurred_at: string;
  metadata: Record<string, unknown>;
}

export interface WatchRule {
  schema_version: typeof TERMINAL_NOTIFICATIONS_SCHEMA;
  id: string;
  name: string;
  enabled: boolean;
  events: WatchEventType[];
  project_id: string | null;
  project_path_pattern: string | null;
  agent_id: string | null;
  priority_min: string | null;
  quiet: boolean;
  bell: boolean;
  desktop_notify: boolean;
  hook_command: string | null;
  created_at: string;
  updated_at: string;
}

export interface WatchPreferences {
  schema_version: typeof TERMINAL_NOTIFICATIONS_SCHEMA;
  enabled: boolean;
  poll_interval_seconds: number;
  bell: boolean;
  desktop_notify: boolean;
  quiet: boolean;
  due_soon_hours: number;
  stale_minutes: number;
  stale_lock_minutes: number;
  updated_at: string;
}

export interface CreateWatchRuleInput {
  name: string;
  events?: WatchEventType[];
  project_id?: string;
  project_path_pattern?: string;
  agent_id?: string;
  priority_min?: string;
  quiet?: boolean;
  bell?: boolean;
  desktop_notify?: boolean;
  hook_command?: string;
  enabled?: boolean;
}

export interface UpdateWatchRuleInput extends Partial<CreateWatchRuleInput> {
  id: string;
}

export interface PollWatchOptions {
  project_id?: string;
  agent_id?: string;
  project_path?: string;
  since?: string;
  dry_run?: boolean;
  quiet?: boolean;
  bell?: boolean;
  desktop?: boolean;
  emit?: (line: string) => void;
  onBell?: () => void;
  onDesktop?: (title: string, message: string) => boolean;
  onHook?: (command: string, event: WatchEvent) => void;
}

export interface PollWatchResult {
  schema_version: typeof TERMINAL_NOTIFICATIONS_SCHEMA;
  polled_at: string;
  since: string;
  events_found: number;
  notifications_sent: number;
  events: WatchEvent[];
  matched: Array<{ event: WatchEvent; rule_id: string | null; rule_name: string | null }>;
}

export interface WatchStatus {
  schema_version: typeof TERMINAL_NOTIFICATIONS_SCHEMA;
  enabled: boolean;
  last_poll_at: string | null;
  rules_total: number;
  rules_enabled: number;
  dedup_entries: number;
  preferences: WatchPreferences;
}

const PRIORITY_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const DEFAULT_PREFS: Omit<WatchPreferences, "updated_at"> = {
  schema_version: TERMINAL_NOTIFICATIONS_SCHEMA,
  enabled: true,
  poll_interval_seconds: 5,
  bell: true,
  desktop_notify: false,
  quiet: false,
  due_soon_hours: 24,
  stale_minutes: 30,
  stale_lock_minutes: 30,
};

const DEFAULT_RULES: CreateWatchRuleInput[] = [
  {
    name: "Task completions",
    events: ["task.completed", "task.failed"],
  },
  {
    name: "Due and stale work",
    events: ["task.due_soon", "task.due_overdue", "task.stale", "task.stale_lock"],
  },
  {
    name: "Approvals",
    events: ["approval.pending", "approval.approved", "approval.rejected"],
  },
];

function rowToRule(row: Record<string, unknown>): WatchRule {
  const eventsRaw = JSON.parse((row.events as string) || "[]") as string[];
  return {
    schema_version: TERMINAL_NOTIFICATIONS_SCHEMA,
    id: row.id as string,
    name: row.name as string,
    enabled: !!(row.enabled as number),
    events: eventsRaw.filter((e): e is WatchEventType => (WATCH_EVENT_TYPES as readonly string[]).includes(e)),
    project_id: (row.project_id as string | null) ?? null,
    project_path_pattern: (row.project_path_pattern as string | null) ?? null,
    agent_id: (row.agent_id as string | null) ?? null,
    priority_min: (row.priority_min as string | null) ?? null,
    quiet: !!(row.quiet as number),
    bell: row.bell === undefined ? true : !!(row.bell as number),
    desktop_notify: !!(row.desktop_notify as number),
    hook_command: (row.hook_command as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function getWatchState(key: string, db: Database): string | null {
  const row = db.query("SELECT value FROM watch_state WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

function setWatchState(key: string, value: string, db: Database): void {
  const ts = now();
  db.run(
    `INSERT INTO watch_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, ts],
  );
}

function isDeduped(eventKey: string, db: Database): boolean {
  const row = db.query("SELECT 1 FROM watch_dedup WHERE event_key = ?").get(eventKey);
  return !!row;
}

function markDeduped(eventKey: string, db: Database): void {
  db.run("INSERT OR IGNORE INTO watch_dedup (event_key, fired_at) VALUES (?, ?)", [eventKey, now()]);
}

export function getWatchPreferences(db?: Database): WatchPreferences {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM watch_preferences WHERE id = 'default'").get() as Record<string, unknown> | null;
  if (!row) return { ...DEFAULT_PREFS, updated_at: now() };
  return {
    schema_version: TERMINAL_NOTIFICATIONS_SCHEMA,
    enabled: !!(row.enabled as number),
    poll_interval_seconds: row.poll_interval_seconds as number,
    bell: !!(row.bell as number),
    desktop_notify: !!(row.desktop_notify as number),
    quiet: !!(row.quiet as number),
    due_soon_hours: row.due_soon_hours as number,
    stale_minutes: row.stale_minutes as number,
    stale_lock_minutes: row.stale_lock_minutes as number,
    updated_at: row.updated_at as string,
  };
}

export function setWatchPreferences(
  input: Partial<Omit<WatchPreferences, "schema_version" | "updated_at">>,
  db?: Database,
): WatchPreferences {
  const d = db || getDatabase();
  const current = getWatchPreferences(d);
  const next = {
    enabled: input.enabled ?? current.enabled,
    poll_interval_seconds: input.poll_interval_seconds ?? current.poll_interval_seconds,
    bell: input.bell ?? current.bell,
    desktop_notify: input.desktop_notify ?? current.desktop_notify,
    quiet: input.quiet ?? current.quiet,
    due_soon_hours: input.due_soon_hours ?? current.due_soon_hours,
    stale_minutes: input.stale_minutes ?? current.stale_minutes,
    stale_lock_minutes: input.stale_lock_minutes ?? current.stale_lock_minutes,
    updated_at: now(),
  };

  d.run(
    `INSERT INTO watch_preferences (id, enabled, poll_interval_seconds, bell, desktop_notify, quiet, due_soon_hours, stale_minutes, stale_lock_minutes, updated_at)
     VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       enabled = excluded.enabled,
       poll_interval_seconds = excluded.poll_interval_seconds,
       bell = excluded.bell,
       desktop_notify = excluded.desktop_notify,
       quiet = excluded.quiet,
       due_soon_hours = excluded.due_soon_hours,
       stale_minutes = excluded.stale_minutes,
       stale_lock_minutes = excluded.stale_lock_minutes,
       updated_at = excluded.updated_at`,
    [
      next.enabled ? 1 : 0,
      next.poll_interval_seconds,
      next.bell ? 1 : 0,
      next.desktop_notify ? 1 : 0,
      next.quiet ? 1 : 0,
      next.due_soon_hours,
      next.stale_minutes,
      next.stale_lock_minutes,
      next.updated_at,
    ],
  );

  return getWatchPreferences(d);
}

export function ensureDefaultWatchRules(db?: Database): WatchRule[] {
  const d = db || getDatabase();
  const count = (d.query("SELECT COUNT(*) as c FROM watch_rules").get() as { c: number }).c;
  if (count > 0) return listWatchRules({}, d);

  const created: WatchRule[] = [];
  for (const rule of DEFAULT_RULES) {
    created.push(createWatchRule(rule, d));
  }
  return created;
}

export function createWatchRule(input: CreateWatchRuleInput, db?: Database): WatchRule {
  const d = db || getDatabase();
  const id = uuid();
  const ts = now();
  d.run(
    `INSERT INTO watch_rules
     (id, name, enabled, events, project_id, project_path_pattern, agent_id, priority_min, quiet, bell, desktop_notify, hook_command, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.enabled === false ? 0 : 1,
      JSON.stringify(input.events ?? []),
      input.project_id ?? null,
      input.project_path_pattern ?? null,
      input.agent_id ?? null,
      input.priority_min ?? null,
      input.quiet ? 1 : 0,
      input.bell === false ? 0 : 1,
      input.desktop_notify ? 1 : 0,
      input.hook_command ?? null,
      ts,
      ts,
    ],
  );
  return getWatchRule(id, d)!;
}

export function updateWatchRule(input: UpdateWatchRuleInput, db?: Database): WatchRule | null {
  const d = db || getDatabase();
  const existing = getWatchRule(input.id, d);
  if (!existing) return null;

  const ts = now();
  d.run(
    `UPDATE watch_rules SET
      name = ?, enabled = ?, events = ?, project_id = ?, project_path_pattern = ?, agent_id = ?,
      priority_min = ?, quiet = ?, bell = ?, desktop_notify = ?, hook_command = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.name ?? existing.name,
      (input.enabled ?? existing.enabled) ? 1 : 0,
      JSON.stringify(input.events ?? existing.events),
      input.project_id !== undefined ? input.project_id : existing.project_id,
      input.project_path_pattern !== undefined ? input.project_path_pattern : existing.project_path_pattern,
      input.agent_id !== undefined ? input.agent_id : existing.agent_id,
      input.priority_min !== undefined ? input.priority_min : existing.priority_min,
      (input.quiet ?? existing.quiet) ? 1 : 0,
      (input.bell ?? existing.bell) ? 1 : 0,
      (input.desktop_notify ?? existing.desktop_notify) ? 1 : 0,
      input.hook_command !== undefined ? input.hook_command : existing.hook_command,
      ts,
      input.id,
    ],
  );
  return getWatchRule(input.id, d);
}

export function deleteWatchRule(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM watch_rules WHERE id = ?", [id]);
  return result.changes > 0;
}

export function getWatchRule(id: string, db?: Database): WatchRule | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM watch_rules WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? rowToRule(row) : null;
}

export function listWatchRules(
  filters: { project_id?: string; enabled?: boolean } = {},
  db?: Database,
): WatchRule[] {
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.project_id) {
    conditions.push("(project_id IS NULL OR project_id = ?)");
    params.push(filters.project_id);
  }
  if (filters.enabled !== undefined) {
    conditions.push("enabled = ?");
    params.push(filters.enabled ? 1 : 0);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = d.query(`SELECT * FROM watch_rules ${where} ORDER BY created_at ASC`).all(...params) as Record<string, unknown>[];
  return rows.map(rowToRule);
}

function matchesProjectPath(pattern: string | null, projectPath?: string, projectId?: string | null, db?: Database): boolean {
  if (!pattern) return true;
  if (projectPath && projectPath.startsWith(pattern)) return true;
  if (projectId && db) {
    const project = getProject(projectId, db);
    if (project?.path && project.path.startsWith(pattern)) return true;
  }
  return false;
}

function taskMeetsPriority(task: Task | null, priorityMin: string | null): boolean {
  if (!priorityMin || !task) return true;
  return (PRIORITY_RANK[task.priority] ?? 0) >= (PRIORITY_RANK[priorityMin] ?? 0);
}

export function ruleMatchesEvent(
  rule: WatchRule,
  event: WatchEvent,
  context: { project_path?: string } = {},
): boolean {
  if (!rule.enabled) return false;
  if (rule.events.length > 0 && !rule.events.includes(event.event)) return false;
  if (rule.project_id && event.project_id !== rule.project_id) return false;
  if (rule.agent_id && event.agent_id !== rule.agent_id) return false;
  if (!matchesProjectPath(rule.project_path_pattern, context.project_path, event.project_id)) return false;

  if (rule.priority_min && event.entity_type === "task") {
    const task = getTask(event.entity_id);
    if (!taskMeetsPriority(task, rule.priority_min)) return false;
  }

  return true;
}

function mapActivityToEvent(record: ActivityRecord, task?: Task | null): WatchEvent | null {
  const base = {
    schema_version: TERMINAL_NOTIFICATIONS_SCHEMA,
    entity_id: record.entity_id,
    project_id: task?.project_id ?? null,
    agent_id: record.actor_id,
    occurred_at: record.created_at,
    metadata: { ...record.metadata, action: record.action, field: record.field },
  };

  if (record.entity_type === "task") {
    if (record.action === "create") {
      return {
        ...base,
        id: `activity:${record.id}`,
        event: "task.created",
        entity_type: "task",
        title: task?.title ?? `Task ${record.entity_id.slice(0, 8)}`,
        message: task?.short_id ? `${task.short_id} created` : "Task created",
        severity: "info",
      };
    }
    if (record.action === "start") {
      return {
        ...base,
        id: `activity:${record.id}`,
        event: "task.started",
        entity_type: "task",
        title: task?.title ?? `Task ${record.entity_id.slice(0, 8)}`,
        message: "Task started",
        severity: "info",
      };
    }
    if (record.action === "complete") {
      return {
        ...base,
        id: `activity:${record.id}`,
        event: "task.completed",
        entity_type: "task",
        title: task?.title ?? `Task ${record.entity_id.slice(0, 8)}`,
        message: "Task completed",
        severity: "info",
      };
    }
    if (record.action === "fail") {
      return {
        ...base,
        id: `activity:${record.id}`,
        event: "task.failed",
        entity_type: "task",
        title: task?.title ?? `Task ${record.entity_id.slice(0, 8)}`,
        message: "Task failed",
        severity: "error",
      };
    }
    if (record.action === "update" && record.field === "assigned_to") {
      return {
        ...base,
        id: `activity:${record.id}`,
        event: "task.assigned",
        entity_type: "task",
        title: task?.title ?? `Task ${record.entity_id.slice(0, 8)}`,
        message: `Assigned to ${record.new_value ?? "unknown"}`,
        severity: "info",
      };
    }
    if (record.action === "update" && record.field === "status") {
      return {
        ...base,
        id: `activity:${record.id}`,
        event: "task.status_changed",
        entity_type: "task",
        title: task?.title ?? `Task ${record.entity_id.slice(0, 8)}`,
        message: `${record.old_value ?? "?"} → ${record.new_value ?? "?"}`,
        severity: "info",
      };
    }
    if (record.action === "approve_gate") {
      return {
        ...base,
        id: `activity:${record.id}`,
        event: "approval.approved",
        entity_type: "approval",
        title: task?.title ?? `Approval ${record.entity_id.slice(0, 8)}`,
        message: "Approval granted",
        severity: "info",
      };
    }
    if (record.action === "reject_gate") {
      return {
        ...base,
        id: `activity:${record.id}`,
        event: "approval.rejected",
        entity_type: "approval",
        title: task?.title ?? `Approval ${record.entity_id.slice(0, 8)}`,
        message: "Approval rejected",
        severity: "warn",
      };
    }
    if (record.action === "lease_expire") {
      return {
        ...base,
        id: `activity:${record.id}`,
        event: "task.stale_lock",
        entity_type: "task",
        title: task?.title ?? `Task ${record.entity_id.slice(0, 8)}`,
        message: "Task lock expired",
        severity: "warn",
      };
    }
    if (record.action === "stale_recovery") {
      return {
        ...base,
        id: `activity:${record.id}`,
        event: "task.stale",
        entity_type: "task",
        title: task?.title ?? `Task ${record.entity_id.slice(0, 8)}`,
        message: "Stale task recovered",
        severity: "warn",
      };
    }
    if (record.action.includes("verification") && record.new_value === "failed") {
      return {
        ...base,
        id: `activity:${record.id}`,
        event: "check.failed",
        entity_type: "check",
        title: task?.title ?? `Check ${record.entity_id.slice(0, 8)}`,
        message: "Verification check failed",
        severity: "error",
      };
    }
  }

  if (record.entity_type === "plan") {
    if (record.action === "complete" || record.new_value === "completed") {
      return {
        ...base,
        id: `activity:${record.id}`,
        event: "plan.completed",
        entity_type: "plan",
        title: `Plan ${record.entity_id.slice(0, 8)}`,
        message: "Plan completed",
        severity: "info",
        project_id: (record.metadata.project_id as string | null) ?? null,
      };
    }
    return {
      ...base,
      id: `activity:${record.id}`,
      event: "plan.updated",
      entity_type: "plan",
      title: `Plan ${record.entity_id.slice(0, 8)}`,
      message: record.action,
      severity: "info",
      project_id: (record.metadata.project_id as string | null) ?? null,
    };
  }

  if (record.entity_type === "run_record") {
    if (record.action === "start" || record.new_value === "running") {
      return {
        ...base,
        id: `activity:${record.id}`,
        event: "run.started",
        entity_type: "run_record",
        title: `Run ${record.entity_id.slice(0, 8)}`,
        message: "Run started",
        severity: "info",
      };
    }
    if (record.action === "complete" || record.new_value === "completed") {
      return {
        ...base,
        id: `activity:${record.id}`,
        event: "run.completed",
        entity_type: "run_record",
        title: `Run ${record.entity_id.slice(0, 8)}`,
        message: "Run completed",
        severity: "info",
      };
    }
    if (record.action === "fail" || record.new_value === "failed") {
      return {
        ...base,
        id: `activity:${record.id}`,
        event: "run.failed",
        entity_type: "run_record",
        title: `Run ${record.entity_id.slice(0, 8)}`,
        message: "Run failed",
        severity: "error",
      };
    }
  }

  return null;
}

function collectActivityEvents(since: string, filters: { project_id?: string; agent_id?: string }, db: Database): WatchEvent[] {
  const records = listActivity({ since, order: "asc", limit: 500 }, db);
  const events: WatchEvent[] = [];

  for (const record of records) {
    const task = record.entity_type === "task" ? getTask(record.entity_id, db) : null;
    if (filters.project_id && task?.project_id !== filters.project_id) continue;
    if (filters.agent_id && record.actor_id !== filters.agent_id && task?.assigned_to !== filters.agent_id) continue;

    const mapped = mapActivityToEvent(record, task);
    if (mapped) events.push(mapped);
  }

  return events;
}

function collectSyntheticEvents(
  since: string,
  prefs: WatchPreferences,
  filters: { project_id?: string; agent_id?: string },
  db: Database,
): WatchEvent[] {
  const events: WatchEvent[] = [];
  const ts = now();

  for (const task of getUpcomingDueTasks({ hours: prefs.due_soon_hours, ...filters }, db)) {
    const key = `task.due_soon:${task.id}`;
    if (isDeduped(key, db)) continue;
    events.push({
      schema_version: TERMINAL_NOTIFICATIONS_SCHEMA,
      id: key,
      event: "task.due_soon",
      entity_type: "task",
      entity_id: task.id,
      title: task.short_id ? `${task.short_id} ${task.title}` : task.title,
      message: `Due at ${task.due_at}`,
      project_id: task.project_id,
      agent_id: task.assigned_to,
      severity: "warn",
      occurred_at: task.due_at ?? ts,
      metadata: { due_at: task.due_at },
    });
  }

  for (const task of getOverdueTasks(filters.project_id, db)) {
    if (filters.agent_id && task.assigned_to !== filters.agent_id) continue;
    const key = `task.due_overdue:${task.id}`;
    if (isDeduped(key, db)) continue;
    events.push({
      schema_version: TERMINAL_NOTIFICATIONS_SCHEMA,
      id: key,
      event: "task.due_overdue",
      entity_type: "task",
      entity_id: task.id,
      title: task.short_id ? `${task.short_id} ${task.title}` : task.title,
      message: `Overdue since ${task.due_at}`,
      project_id: task.project_id,
      agent_id: task.assigned_to,
      severity: "error",
      occurred_at: task.due_at ?? ts,
      metadata: { due_at: task.due_at },
    });
  }

  for (const task of getStaleTasks(prefs.stale_minutes, filters, db)) {
    const key = `task.stale:${task.id}:${task.updated_at}`;
    if (isDeduped(key, db)) continue;
    events.push({
      schema_version: TERMINAL_NOTIFICATIONS_SCHEMA,
      id: key,
      event: "task.stale",
      entity_type: "task",
      entity_id: task.id,
      title: task.short_id ? `${task.short_id} ${task.title}` : task.title,
      message: "No recent activity",
      project_id: task.project_id,
      agent_id: task.assigned_to,
      severity: "warn",
      occurred_at: task.updated_at,
      metadata: { updated_at: task.updated_at },
    });
  }

  const lockCutoff = new Date(Date.now() - prefs.stale_lock_minutes * 60000).toISOString();
  let lockQuery = `SELECT id, short_id, title, project_id, assigned_to, locked_by, locked_at FROM tasks
    WHERE locked_by IS NOT NULL AND locked_at IS NOT NULL AND locked_at < ?
    AND status NOT IN ('completed', 'cancelled', 'failed', 'archived')`;
  const lockParams: unknown[] = [lockCutoff];
  if (filters.project_id) {
    lockQuery += " AND project_id = ?";
    lockParams.push(filters.project_id);
  }
  if (filters.agent_id) {
    lockQuery += " AND (assigned_to = ? OR locked_by = ?)";
    lockParams.push(filters.agent_id, filters.agent_id);
  }

  const staleLocks = db.query(lockQuery).all(...lockParams) as Array<Record<string, unknown>>;
  for (const row of staleLocks) {
    const taskId = row.id as string;
    const key = `task.stale_lock:${taskId}:${row.locked_at as string}`;
    if (isDeduped(key, db)) continue;
    events.push({
      schema_version: TERMINAL_NOTIFICATIONS_SCHEMA,
      id: key,
      event: "task.stale_lock",
      entity_type: "task",
      entity_id: taskId,
      title: row.short_id ? `${row.short_id as string} ${row.title as string}` : (row.title as string),
      message: `Lock held since ${row.locked_at as string}`,
      project_id: (row.project_id as string | null) ?? null,
      agent_id: (row.locked_by as string | null) ?? null,
      severity: "warn",
      occurred_at: row.locked_at as string,
      metadata: { locked_by: row.locked_by, locked_at: row.locked_at },
    });
  }

  let approvalQuery = `SELECT id, task_id, gate_type, status, requested_by, created_at FROM task_approval_requests
    WHERE status = 'pending' AND created_at > ?`;
  const approvalParams: unknown[] = [since];
  if (filters.project_id) {
    approvalQuery = `SELECT ar.id, ar.task_id, ar.gate_type, ar.status, ar.requested_by, ar.created_at, t.project_id
      FROM task_approval_requests ar JOIN tasks t ON t.id = ar.task_id
      WHERE ar.status = 'pending' AND ar.created_at > ? AND t.project_id = ?`;
    approvalParams.push(filters.project_id);
  }

  const approvals = db.query(approvalQuery).all(...approvalParams) as Array<Record<string, unknown>>;
  for (const row of approvals) {
    const approvalId = row.id as string;
    const key = `approval.pending:${approvalId}`;
    if (isDeduped(key, db)) continue;
    const task = getTask(row.task_id as string, db);
    events.push({
      schema_version: TERMINAL_NOTIFICATIONS_SCHEMA,
      id: key,
      event: "approval.pending",
      entity_type: "approval",
      entity_id: approvalId,
      title: task?.title ?? `Approval ${approvalId.slice(0, 8)}`,
      message: `Pending ${row.gate_type as string} approval`,
      project_id: task?.project_id ?? (row.project_id as string | null) ?? null,
      agent_id: (row.requested_by as string | null) ?? null,
      severity: "warn",
      occurred_at: row.created_at as string,
      metadata: { task_id: row.task_id, gate_type: row.gate_type },
    });
  }

  return events;
}

export function collectWatchEvents(
  since: string,
  filters: { project_id?: string; agent_id?: string } = {},
  db?: Database,
): WatchEvent[] {
  const d = db || getDatabase();
  const prefs = getWatchPreferences(d);
  const activityEvents = collectActivityEvents(since, filters, d);
  const syntheticEvents = collectSyntheticEvents(since, prefs, filters, d);

  const merged = new Map<string, WatchEvent>();
  for (const event of [...activityEvents, ...syntheticEvents]) {
    merged.set(event.id, event);
  }
  return [...merged.values()].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}

export function formatTerminalNotification(event: WatchEvent): string {
  const label = event.event.padEnd(22);
  const id = event.entity_id.slice(0, 8);
  const msg = event.message ? ` — ${event.message}` : "";
  return `[${event.severity.toUpperCase()}] ${label} ${id} ${event.title}${msg}`;
}

function defaultBell(): void {
  process.stdout.write("\x07");
}

function defaultDesktopNotify(title: string, message: string): boolean {
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

function runHook(command: string, event: WatchEvent): void {
  const env = {
    ...process.env,
    TODOS_WATCH_EVENT: event.event,
    TODOS_WATCH_ENTITY_ID: event.entity_id,
    TODOS_WATCH_TITLE: event.title,
    TODOS_WATCH_MESSAGE: event.message ?? "",
    TODOS_WATCH_PROJECT_ID: event.project_id ?? "",
    TODOS_WATCH_AGENT_ID: event.agent_id ?? "",
  };
  execSync(command, { stdio: "ignore", timeout: 10000, env });
}

export function emitTerminalNotification(
  event: WatchEvent,
  rule: WatchRule | null,
  prefs: WatchPreferences,
  options: PollWatchOptions = {},
): void {
  const quiet = options.quiet ?? rule?.quiet ?? prefs.quiet;
  const bell = options.bell ?? rule?.bell ?? prefs.bell;
  const desktop = options.desktop ?? rule?.desktop_notify ?? prefs.desktop_notify;
  const emit = options.emit ?? ((line: string) => process.stdout.write(`${line}\n`));
  const onBell = options.onBell ?? defaultBell;
  const onDesktop = options.onDesktop ?? defaultDesktopNotify;
  const onHook = options.onHook ?? ((cmd: string, ev: WatchEvent) => runHook(cmd, ev));

  if (!quiet) emit(formatTerminalNotification(event));
  if (bell) onBell();
  if (desktop) onDesktop(event.title, event.message ?? event.title);
  const hook = rule?.hook_command;
  if (hook) onHook(hook, event);
}

function findMatchingRule(
  event: WatchEvent,
  rules: WatchRule[],
  context: { project_path?: string },
): WatchRule | null {
  for (const rule of rules) {
    if (ruleMatchesEvent(rule, event, context)) return rule;
  }
  return null;
}

export function pollWatchNotifications(options: PollWatchOptions = {}, db?: Database): PollWatchResult {
  const d = db || getDatabase();
  ensureDefaultWatchRules(d);
  syncConfigWatchRules(options.project_path, d);

  const prefs = getWatchPreferences(d);
  const polledAt = now();
  const since = options.since ?? getWatchState("last_poll_at", d) ?? new Date(Date.now() - prefs.poll_interval_seconds * 1000).toISOString();

  const filters = {
    project_id: options.project_id,
    agent_id: options.agent_id,
  };

  const events = collectWatchEvents(since, filters, d);
  const rules = listWatchRules({ enabled: true, project_id: options.project_id }, d);
  const matched: PollWatchResult["matched"] = [];
  let notificationsSent = 0;

  for (const event of events) {
    const rule = findMatchingRule(event, rules, { project_path: options.project_path });
    if (rules.length > 0 && !rule) continue;

    if (isDeduped(event.id, d)) continue;
    if (!options.dry_run) {
      markDeduped(event.id, d);
      emitTerminalNotification(event, rule, prefs, options);
      notificationsSent++;
    }

    matched.push({
      event,
      rule_id: rule?.id ?? null,
      rule_name: rule?.name ?? null,
    });
  }

  if (!options.dry_run) {
    setWatchState("last_poll_at", polledAt, d);
  }

  return {
    schema_version: TERMINAL_NOTIFICATIONS_SCHEMA,
    polled_at: polledAt,
    since,
    events_found: events.length,
    notifications_sent: notificationsSent,
    events,
    matched,
  };
}

export function getWatchStatus(db?: Database): WatchStatus {
  const d = db || getDatabase();
  ensureDefaultWatchRules(d);
  const prefs = getWatchPreferences(d);
  const rules = listWatchRules({}, d);
  const dedup = (d.query("SELECT COUNT(*) as c FROM watch_dedup").get() as { c: number }).c;

  return {
    schema_version: TERMINAL_NOTIFICATIONS_SCHEMA,
    enabled: prefs.enabled,
    last_poll_at: getWatchState("last_poll_at", d),
    rules_total: rules.length,
    rules_enabled: rules.filter((r) => r.enabled).length,
    dedup_entries: dedup,
    preferences: prefs,
  };
}

function patternFromConfig(pattern: WatchRulePattern, projectPath?: string): CreateWatchRuleInput {
  return {
    name: pattern.name ?? `Config: ${pattern.project_path ?? projectPath ?? "global"}`,
    events: (pattern.events ?? []) as WatchEventType[],
    project_path_pattern: pattern.project_path ?? projectPath,
    quiet: pattern.quiet,
    bell: pattern.bell,
    desktop_notify: pattern.desktop_notify,
    hook_command: pattern.hook_command,
    enabled: pattern.enabled,
  };
}

export function syncConfigWatchRules(projectPath?: string, db?: Database): WatchRule[] {
  const d = db || getDatabase();
  const config = loadConfig();
  const synced: WatchRule[] = [];

  const globalPatterns = config.watch_rules ?? [];
  for (const pattern of globalPatterns) {
    const name = pattern.name ?? `Config: ${pattern.project_path ?? "global"}`;
    const existing = d.query("SELECT id FROM watch_rules WHERE name = ?").get(name) as { id: string } | null;
    const input = patternFromConfig(pattern);
    if (existing) {
      const updated = updateWatchRule({ id: existing.id, ...input, name }, d);
      if (updated) synced.push(updated);
    } else {
      synced.push(createWatchRule({ ...input, name }, d));
    }
  }

  if (projectPath && config.project_watch_rules) {
    let bestKey: string | null = null;
    let bestLen = 0;
    for (const key of Object.keys(config.project_watch_rules)) {
      if (projectPath.startsWith(key) && key.length > bestLen) {
        bestKey = key;
        bestLen = key.length;
      }
    }
    if (bestKey) {
      for (const pattern of config.project_watch_rules[bestKey] ?? []) {
        const name = pattern.name ?? `Config: ${bestKey}`;
        const existing = d.query("SELECT id FROM watch_rules WHERE name = ?").get(name) as { id: string } | null;
        const input = patternFromConfig(pattern, bestKey);
        if (existing) {
          const updated = updateWatchRule({ id: existing.id, ...input, name }, d);
          if (updated) synced.push(updated);
        } else {
          synced.push(createWatchRule({ ...input, name }, d));
        }
      }
    }
  }

  return synced;
}

export function getWatchDocs(): string {
  return [
    "Local terminal notifications and watch rules (offline, SQLite-backed)",
    "",
    "Event types:",
    `  ${WATCH_EVENT_TYPES.join(", ")}`,
    "",
    "Workflow:",
    "  1. todos watch once          — poll once and print matching notifications",
    "  2. todos watch               — listen loop (default)",
    "  3. todos watch rules list    — show configured rules",
    "  4. todos watch rules add     — add a rule",
    "  5. todos watch status        — cursor + rule summary",
    "  6. todos watch prefs         — bell, quiet, interval, desktop notify",
    "",
    "Per-project patterns: ~/.hasna/todos/config.json",
    '  { "project_watch_rules": { "/path/to/project": [{ "events": ["task.completed"], "bell": true }] } }',
  ].join("\n");
}
