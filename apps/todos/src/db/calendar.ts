import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { CalendarEvent, CalendarEventKind, LocalCalendarItem, LocalCalendarItemRow, Task } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { getTask, listTasks } from "./task-crud.js";
import { listTaskRuns, type TaskRun } from "./task-runs.js";

export interface CreateCalendarItemInput {
  kind?: CalendarEventKind;
  title: string;
  description?: string;
  starts_at: string;
  ends_at?: string;
  timezone?: string;
  project_id?: string;
  task_id?: string;
  plan_id?: string;
  run_id?: string;
  recurrence_rule?: string;
  metadata?: Record<string, unknown>;
}

export interface CalendarQuery {
  project_id?: string;
  task_id?: string;
  plan_id?: string;
  run_id?: string;
  kind?: CalendarEventKind;
  from?: string;
  to?: string;
  include_completed?: boolean;
  include_runs?: boolean;
  include_sla?: boolean;
  include_local?: boolean;
  limit?: number;
}

export interface IcsExportOptions extends CalendarQuery {
  calendar_name?: string;
  product_id?: string;
  redact?: boolean;
  generated_at?: string;
}

export interface IcsImportResult {
  imported: number;
  skipped: number;
  items: LocalCalendarItem[];
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function rowToCalendarItem(row: LocalCalendarItemRow): LocalCalendarItem {
  return { ...row, metadata: parseJsonObject(row.metadata) };
}

function eventFromLocal(item: LocalCalendarItem): CalendarEvent {
  return {
    ...item,
    source: "local",
    badges: [item.kind, item.timezone || "floating"],
  };
}

function addMinutes(iso: string, minutes: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms + minutes * 60000).toISOString();
}

function eventFromTaskDue(task: Task): CalendarEvent | null {
  if (!task.due_at) return null;
  return {
    id: `task-due-${task.id}`,
    kind: "task_due",
    title: `Due: ${task.title}`,
    description: task.description,
    starts_at: task.due_at,
    ends_at: null,
    timezone: null,
    project_id: task.project_id,
    task_id: task.id,
    plan_id: task.plan_id,
    run_id: null,
    recurrence_rule: task.recurrence_rule,
    source: "task",
    badges: ["due", task.priority, task.status],
    metadata: { priority: task.priority, status: task.status, short_id: task.short_id },
  };
}

function eventFromTaskSla(task: Task): CalendarEvent | null {
  if (!task.sla_minutes || ["completed", "cancelled", "failed"].includes(task.status)) return null;
  const base = task.started_at || task.created_at;
  if (!base) return null;
  const startsAt = addMinutes(base, task.sla_minutes);
  return {
    id: `task-sla-${task.id}`,
    kind: "task_sla",
    title: `SLA: ${task.title}`,
    description: task.description,
    starts_at: startsAt,
    ends_at: null,
    timezone: null,
    project_id: task.project_id,
    task_id: task.id,
    plan_id: task.plan_id,
    run_id: null,
    recurrence_rule: null,
    source: "task",
    badges: ["sla", task.priority, task.status],
    metadata: { sla_minutes: task.sla_minutes, status: task.status, short_id: task.short_id },
  };
}

function eventFromRun(run: TaskRun, task: Task | null): CalendarEvent {
  return {
    id: `run-${run.id}`,
    kind: "run",
    title: `Run: ${run.title || task?.title || run.id.slice(0, 8)}`,
    description: run.summary,
    starts_at: run.started_at,
    ends_at: run.completed_at,
    timezone: null,
    project_id: task?.project_id || null,
    task_id: run.task_id,
    plan_id: task?.plan_id || null,
    run_id: run.id,
    recurrence_rule: null,
    source: "run",
    badges: ["run", run.status],
    metadata: { status: run.status, agent_id: run.agent_id },
  };
}

function inWindow(event: CalendarEvent, query: CalendarQuery): boolean {
  const start = Date.parse(event.starts_at);
  if (query.from && Number.isFinite(start) && start < Date.parse(query.from)) return false;
  if (query.to && Number.isFinite(start) && start > Date.parse(query.to)) return false;
  if (query.kind && event.kind !== query.kind) return false;
  if (query.project_id && event.project_id !== query.project_id) return false;
  if (query.task_id && event.task_id !== query.task_id) return false;
  if (query.plan_id && event.plan_id !== query.plan_id) return false;
  if (query.run_id && event.run_id !== query.run_id) return false;
  return true;
}

export function createCalendarItem(input: CreateCalendarItemInput, db?: Database): LocalCalendarItem {
  const d = getDatabase(db);
  const id = uuid();
  const timestamp = now();
  const kind = input.kind || "work_block";
  d.run(
    `INSERT INTO local_calendar_items (
      id, kind, title, description, starts_at, ends_at, timezone, project_id, task_id, plan_id, run_id,
      recurrence_rule, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      kind,
      input.title,
      input.description || null,
      input.starts_at,
      input.ends_at || null,
      input.timezone || null,
      input.project_id || null,
      input.task_id || null,
      input.plan_id || null,
      input.run_id || null,
      input.recurrence_rule || null,
      JSON.stringify(input.metadata || {}),
      timestamp,
      timestamp,
    ],
  );
  return getCalendarItem(id, d)!;
}

export function getCalendarItem(id: string, db?: Database): LocalCalendarItem | null {
  const d = getDatabase(db);
  const resolved = id.length >= 36
    ? id
    : ((d.query("SELECT id FROM local_calendar_items WHERE id LIKE ?").all(`${id}%`) as { id: string }[]).length === 1
      ? (d.query("SELECT id FROM local_calendar_items WHERE id LIKE ?").get(`${id}%`) as { id: string }).id
      : id);
  const row = d.query("SELECT * FROM local_calendar_items WHERE id = ?").get(resolved) as LocalCalendarItemRow | null;
  return row ? rowToCalendarItem(row) : null;
}

export function listCalendarItems(query: CalendarQuery = {}, db?: Database): LocalCalendarItem[] {
  const d = getDatabase(db);
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (query.project_id) { conditions.push("project_id = ?"); params.push(query.project_id); }
  if (query.task_id) { conditions.push("task_id = ?"); params.push(query.task_id); }
  if (query.plan_id) { conditions.push("plan_id = ?"); params.push(query.plan_id); }
  if (query.run_id) { conditions.push("run_id = ?"); params.push(query.run_id); }
  if (query.kind) { conditions.push("kind = ?"); params.push(query.kind); }
  if (query.from) { conditions.push("starts_at >= ?"); params.push(query.from); }
  if (query.to) { conditions.push("starts_at <= ?"); params.push(query.to); }
  let sql = "SELECT * FROM local_calendar_items";
  if (conditions.length > 0) sql += ` WHERE ${conditions.join(" AND ")}`;
  sql += " ORDER BY starts_at ASC, created_at ASC";
  if (query.limit) { sql += " LIMIT ?"; params.push(query.limit); }
  return (d.query(sql).all(...params) as LocalCalendarItemRow[]).map(rowToCalendarItem);
}

export function listCalendarEvents(query: CalendarQuery = {}, db?: Database): CalendarEvent[] {
  const d = getDatabase(db);
  const taskFilter = {
    project_id: query.project_id,
    plan_id: query.plan_id,
    ids: query.task_id ? [query.task_id] : undefined,
    include_archived: true,
  };
  const tasks = listTasks(taskFilter, d).filter((task) => query.include_completed || !["completed", "cancelled"].includes(task.status));
  const events: CalendarEvent[] = [];
  for (const task of tasks) {
    const due = eventFromTaskDue(task);
    if (due) events.push(due);
    if (query.include_sla !== false) {
      const sla = eventFromTaskSla(task);
      if (sla) events.push(sla);
    }
  }
  if (query.include_runs !== false) {
    const runs = query.task_id ? listTaskRuns(query.task_id, d) : listTaskRuns(undefined, d);
    for (const run of runs) {
      const task = getTask(run.task_id, d);
      events.push(eventFromRun(run, task));
    }
  }
  if (query.include_local !== false) {
    events.push(...listCalendarItems(query, d).map(eventFromLocal));
  }
  return events
    .filter((event) => inWindow(event, query))
    .sort((left, right) => left.starts_at.localeCompare(right.starts_at) || left.id.localeCompare(right.id))
    .slice(0, query.limit || undefined);
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function icsDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeIcs(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75));
    rest = rest.slice(75);
  }
  chunks.push(rest);
  return chunks.map((chunk, index) => index === 0 ? chunk : ` ${chunk}`).join("\r\n");
}

function recurrenceToRrule(rule: string | null): string | null {
  if (!rule) return null;
  const normalized = rule.trim().toLowerCase();
  if (normalized === "daily" || normalized === "every day") return "FREQ=DAILY";
  if (normalized === "weekly" || normalized === "every week") return "FREQ=WEEKLY";
  if (normalized === "monthly" || normalized === "every month") return "FREQ=MONTHLY";
  if (normalized === "every weekday") return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
  const everyN = normalized.match(/^every (\d+) (day|days|week|weeks|month|months)$/);
  if (everyN) {
    const freq = everyN[2]!.startsWith("day") ? "DAILY" : everyN[2]!.startsWith("week") ? "WEEKLY" : "MONTHLY";
    return `FREQ=${freq};INTERVAL=${everyN[1]}`;
  }
  const days = normalized.match(/^every (mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)(,(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday))*$/);
  if (days) {
    const map: Record<string, string> = { mon: "MO", monday: "MO", tue: "TU", tuesday: "TU", wed: "WE", wednesday: "WE", thu: "TH", thursday: "TH", fri: "FR", friday: "FR", sat: "SA", saturday: "SA", sun: "SU", sunday: "SU" };
    const byday = normalized.replace("every ", "").split(",").map((day) => map[day] || "").filter(Boolean).join(",");
    if (byday) return `FREQ=WEEKLY;BYDAY=${byday}`;
  }
  if (normalized.startsWith("freq=")) return rule.toUpperCase();
  return null;
}

export function exportCalendarIcs(options: IcsExportOptions = {}, db?: Database): { filename: string; content: string; events: CalendarEvent[] } {
  const events = listCalendarEvents(options, db);
  const generatedAt = options.generated_at || now();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${options.product_id || "-//hasna//todos local calendar//EN"}`,
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeIcs(options.calendar_name || "Hasna Todos")}`,
  ];
  for (const event of events) {
    const title = options.redact ? `${event.kind} ${event.id.slice(0, 8)}` : event.title;
    const description = options.redact ? null : event.description;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeIcs(event.id)}@hasna-todos.local`);
    lines.push(`DTSTAMP:${icsDate(generatedAt)}`);
    lines.push(`DTSTART:${icsDate(event.starts_at)}`);
    if (event.ends_at) lines.push(`DTEND:${icsDate(event.ends_at)}`);
    else lines.push(`DUE:${icsDate(event.starts_at)}`);
    lines.push(`SUMMARY:${escapeIcs(title)}`);
    if (description) lines.push(`DESCRIPTION:${escapeIcs(description)}`);
    lines.push(`CATEGORIES:${escapeIcs(event.badges.join(","))}`);
    const rrule = recurrenceToRrule(event.recurrence_rule);
    if (rrule) lines.push(`RRULE:${rrule}`);
    lines.push(`X-HASNA-TODOS-KIND:${event.kind}`);
    if (event.task_id) lines.push(`X-HASNA-TODOS-TASK:${event.task_id}`);
    if (event.plan_id) lines.push(`X-HASNA-TODOS-PLAN:${event.plan_id}`);
    if (event.run_id) lines.push(`X-HASNA-TODOS-RUN:${event.run_id}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return {
    filename: "todos-calendar.ics",
    content: lines.map(foldLine).join("\r\n") + "\r\n",
    events,
  };
}

function unescapeIcs(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function parseIcsDate(value: string): string {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/);
  if (!match) return value;
  return new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] || "0"),
    Number(match[5] || "0"),
    Number(match[6] || "0"),
  )).toISOString();
}

export function importCalendarIcs(content: string, db?: Database): IcsImportResult {
  const d = getDatabase(db);
  const unfolded = content.replace(/\r?\n[ \t]/g, "");
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  const items: LocalCalendarItem[] = [];
  let skipped = 0;
  for (const block of blocks) {
    const fields = new Map<string, string>();
    for (const rawLine of block.split(/\r?\n/)) {
      const index = rawLine.indexOf(":");
      if (index <= 0) continue;
      const key = rawLine.slice(0, index).split(";")[0]!.toUpperCase();
      fields.set(key, rawLine.slice(index + 1));
    }
    const title = unescapeIcs(fields.get("SUMMARY") || "");
    const startsAt = fields.get("DTSTART") || fields.get("DUE");
    if (!title || !startsAt) {
      skipped++;
      continue;
    }
    const item = createCalendarItem({
      kind: "imported",
      title,
      description: fields.has("DESCRIPTION") ? unescapeIcs(fields.get("DESCRIPTION")!) : undefined,
      starts_at: parseIcsDate(startsAt),
      ends_at: fields.has("DTEND") ? parseIcsDate(fields.get("DTEND")!) : undefined,
      recurrence_rule: fields.get("RRULE"),
      metadata: { uid: fields.get("UID") || null, imported_from: "ics" },
    }, d);
    items.push(item);
  }
  return { imported: items.length, skipped, items };
}
