import type { Database } from "bun:sqlite";
import type { ContactEvent, CreateEventInput, EventType } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

// ─── Row mapper ───────────────────────────────────────────────────────────────

interface EventRow {
  id: string;
  title: string;
  type: string;
  event_date: string;
  duration_min: number | null;
  contact_ids: string;
  company_id: string | null;
  notes: string | null;
  outcome: string | null;
  deal_id: string | null;
  created_at: string;
}

function rowToEvent(row: EventRow): ContactEvent {
  let contact_ids: string[] = [];
  try {
    contact_ids = JSON.parse(row.contact_ids) as string[];
  } catch {
    contact_ids = [];
  }
  return {
    id: row.id,
    title: row.title,
    type: row.type as EventType,
    event_date: row.event_date,
    duration_min: row.duration_min,
    contact_ids,
    company_id: row.company_id,
    notes: row.notes,
    outcome: row.outcome,
    deal_id: row.deal_id,
    created_at: row.created_at,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function logEvent(input: CreateEventInput, db?: Database): ContactEvent {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  d.run(
    `INSERT INTO events (id, title, type, event_date, duration_min, contact_ids, company_id, notes, outcome, deal_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.type ?? "meeting",
      input.event_date,
      input.duration_min ?? null,
      JSON.stringify(input.contact_ids ?? []),
      input.company_id ?? null,
      input.notes ?? null,
      input.outcome ?? null,
      input.deal_id ?? null,
      timestamp,
    ]
  );
  return rowToEvent(d.query(`SELECT * FROM events WHERE id = ?`).get(id) as EventRow);
}

export function getEvent(id: string, db?: Database): ContactEvent | null {
  const d = db || getDatabase();
  const row = d.query(`SELECT * FROM events WHERE id = ?`).get(id) as EventRow | null;
  return row ? rowToEvent(row) : null;
}

export interface ListEventsOptions {
  contact_id?: string;
  company_id?: string;
  type?: EventType;
  date_from?: string;
  date_to?: string;
}

export function listEvents(opts: ListEventsOptions = {}, db?: Database): ContactEvent[] {
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  // contact_id filter: check if contact_id is in the JSON contact_ids array
  if (opts.contact_id) {
    conditions.push("contact_ids LIKE ?");
    params.push(`%${opts.contact_id}%`);
  }
  if (opts.company_id) { conditions.push("company_id = ?"); params.push(opts.company_id); }
  if (opts.type) { conditions.push("type = ?"); params.push(opts.type); }
  if (opts.date_from) { conditions.push("event_date >= ?"); params.push(opts.date_from); }
  if (opts.date_to) { conditions.push("event_date <= ?"); params.push(opts.date_to); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = d.query(`SELECT * FROM events ${where} ORDER BY event_date DESC`).all(...params) as EventRow[];
  return rows.map(rowToEvent);
}

export function deleteEvent(id: string, db?: Database): void {
  const d = db || getDatabase();
  d.run(`DELETE FROM events WHERE id = ?`, [id]);
}
