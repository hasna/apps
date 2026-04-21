import { Database } from "bun:sqlite";
import { getDatabase } from "./database.js";
import type { Event, CreateEventInput, UpdateEventInput } from "../types/index.js";
import { NotFoundError } from "../types/index.js";

function rowToEvent(row: any): Event {
  return {
    id: row.id,
    calendar_id: row.calendar_id,
    org_id: row.org_id,
    title: row.title,
    description: row.description,
    location: row.location,
    start_at: row.start_at,
    end_at: row.end_at,
    all_day: !!row.all_day,
    timezone: row.timezone,
    status: row.status as Event["status"],
    busy_type: row.busy_type as Event["busy_type"],
    visibility: row.visibility as Event["visibility"],
    recurrence_rule: row.recurrence_rule,
    recurrence_exception_dates: row.recurrence_exception_dates ? JSON.parse(row.recurrence_exception_dates as string) : null,
    source_task_id: row.source_task_id,
    created_by: row.created_by,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createEvent(input: CreateEventInput, db?: Database): Event {
  db = db || getDatabase();
  const id = crypto.randomUUID().slice(0, 8);

  db.run(
    `INSERT INTO events (id, calendar_id, org_id, title, description, location, start_at, end_at, all_day, timezone, status, busy_type, visibility, recurrence_rule, recurrence_exception_dates, source_task_id, created_by, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.calendar_id, input.org_id, input.title, input.description || null, input.location || null, input.start_at, input.end_at, input.all_day ? 1 : 0, input.timezone || "UTC", input.status || "confirmed", input.busy_type || "busy", input.visibility || "default", input.recurrence_rule || null, input.recurrence_exception_dates ? JSON.stringify(input.recurrence_exception_dates) : null, input.source_task_id || null, input.created_by || null, JSON.stringify(input.metadata || {})]
  );

  return getEvent(id, db)!;
}

export function getEvent(id: string, db?: Database): Event | null {
  db = db || getDatabase();
  const row = db.query("SELECT * FROM events WHERE id = ?").get(id);
  return row ? rowToEvent(row) : null;
}

export interface ListEventsFilter {
  calendar_id?: string;
  org_id?: string;
  status?: string;
  after?: string; // ISO date — events starting after this
  before?: string; // ISO date — events starting before this
  created_by?: string;
  source_task_id?: string;
  limit?: number;
  offset?: number;
}

export function listEvents(filter: ListEventsFilter = {}, db?: Database): Event[] {
  db = db || getDatabase();
  const conditions: string[] = [];
  const params: any[] = [];

  if (filter.calendar_id) { conditions.push("calendar_id = ?"); params.push(filter.calendar_id); }
  if (filter.org_id) { conditions.push("org_id = ?"); params.push(filter.org_id); }
  if (filter.status) { conditions.push("status = ?"); params.push(filter.status); }
  if (filter.after) { conditions.push("start_at >= ?"); params.push(filter.after); }
  if (filter.before) { conditions.push("start_at <= ?"); params.push(filter.before); }
  if (filter.created_by) { conditions.push("created_by = ?"); params.push(filter.created_by); }
  if (filter.source_task_id) { conditions.push("source_task_id = ?"); params.push(filter.source_task_id); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filter.limit ? `LIMIT ${filter.limit}` : "";
  const offset = filter.offset ? `OFFSET ${filter.offset}` : "";

  const rows = db.query(`SELECT * FROM events ${where} ORDER BY start_at ${limit} ${offset}`).all(...params);
  return (rows as any[]).map(rowToEvent);
}

export function updateEvent(id: string, input: UpdateEventInput, db?: Database): Event {
  db = db || getDatabase();
  const existing = getEvent(id, db);
  if (!existing) throw new NotFoundError("Event", id);

  db.run(
    `UPDATE events SET title = ?, description = ?, location = ?, start_at = ?, end_at = ?, all_day = ?, timezone = ?, status = ?, busy_type = ?, visibility = ?, recurrence_rule = ?, recurrence_exception_dates = ?, source_task_id = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?`,
    [input.title ?? existing.title, input.description !== undefined ? input.description : existing.description, input.location !== undefined ? input.location : existing.location, input.start_at ?? existing.start_at, input.end_at ?? existing.end_at, input.all_day !== undefined ? (input.all_day ? 1 : 0) : (existing.all_day ? 1 : 0), input.timezone ?? existing.timezone, input.status ?? existing.status, input.busy_type ?? existing.busy_type, input.visibility ?? existing.visibility, input.recurrence_rule !== undefined ? input.recurrence_rule : existing.recurrence_rule, input.recurrence_exception_dates !== undefined ? (input.recurrence_exception_dates ? JSON.stringify(input.recurrence_exception_dates) : null) : (existing.recurrence_exception_dates ? JSON.stringify(existing.recurrence_exception_dates) : null), input.source_task_id !== undefined ? input.source_task_id : existing.source_task_id, JSON.stringify(input.metadata ?? existing.metadata), id]
  );

  return getEvent(id, db)!;
}

export function deleteEvent(id: string, db?: Database): boolean {
  db = db || getDatabase();
  const result = db.run(`DELETE FROM events WHERE id = ?`, [id]);
  return result.changes > 0;
}

// ── Conflict detection ───────────────────────────────────────────────────────

export interface TimeRange {
  start: string;
  end: string;
}

/** Find events that overlap with the given time range in a calendar */
export function findConflicts(calendarId: string, range: TimeRange, excludeEventId?: string, db?: Database): Event[] {
  db = db || getDatabase();
  const exclude = excludeEventId ? "AND id != ?" : "";
  const params = excludeEventId ? [calendarId, range.end, range.start, excludeEventId] : [calendarId, range.end, range.start];

  // Overlap: event.start < range.end AND event.end > range.start
  const rows = db.query(
    `SELECT * FROM events WHERE calendar_id = ? AND start_at < ? AND end_at > ? AND status != 'cancelled' ${exclude} ORDER BY start_at`,
  ).all(...params);

  return (rows as any[]).map(rowToEvent);
}

/** Find conflicting events across all calendars for a specific agent in the time range */
export function findAgentConflicts(agentId: string, range: TimeRange, excludeEventId?: string, db?: Database): Event[] {
  db = db || getDatabase();
  const exclude = excludeEventId ? "AND e.id != ?" : "";
  const params = excludeEventId ? [agentId, range.end, range.start, excludeEventId] : [agentId, range.end, range.start];

  const rows = db.query(
    `SELECT e.* FROM events e
     INNER JOIN event_attendees a ON a.event_id = e.id
     WHERE a.agent_id = ? AND e.start_at < ? AND e.end_at > ? AND e.status != 'cancelled' ${exclude}
     ORDER BY e.start_at`,
  ).all(...params);

  return (rows as any[]).map(rowToEvent);
}

// ── FTS search ───────────────────────────────────────────────────────────────

export function searchEvents(query: string, orgId?: string, db?: Database): Event[] {
  db = db || getDatabase();
  const rows = db.query(
    `SELECT e.* FROM events e
     INNER JOIN events_fts f ON f.rowid = e.rowid
     WHERE events_fts MATCH ?
     ${orgId ? "AND e.org_id = ?" : ""}
     ORDER BY e.start_at`,
  ).all(query, ...(orgId ? [orgId] : []));

  return (rows as any[]).map(rowToEvent);
}
