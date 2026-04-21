import { Database } from "bun:sqlite";
import { getDatabase } from "./database.js";
import type { EventAttendee, CreateAttendeeInput, UpdateAttendeeInput } from "../types/index.js";
import { NotFoundError } from "../types/index.js";

function rowToAttendee(row: any): EventAttendee {
  return {
    id: row.id,
    event_id: row.event_id,
    agent_id: row.agent_id,
    display_name: row.display_name,
    email: row.email,
    status: row.status as EventAttendee["status"],
    required: !!row.required,
    response_comment: row.response_comment,
    responded_at: row.responded_at,
    created_at: row.created_at,
  };
}

export function createAttendee(input: CreateAttendeeInput, db?: Database): EventAttendee {
  db = db || getDatabase();
  const id = crypto.randomUUID().slice(0, 8);

  db.run(
    `INSERT INTO event_attendees (id, event_id, agent_id, display_name, email, status, required) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.event_id, input.agent_id || null, input.display_name || null, input.email || null, input.status || "needsAction", input.required !== undefined ? (input.required ? 1 : 0) : 1]
  );

  return getAttendee(id, db)!;
}

export function getAttendee(id: string, db?: Database): EventAttendee | null {
  db = db || getDatabase();
  const row = db.query("SELECT * FROM event_attendees WHERE id = ?").get(id);
  return row ? rowToAttendee(row) : null;
}

export function getAttendeesForEvent(eventId: string, db?: Database): EventAttendee[] {
  db = db || getDatabase();
  const rows = db.query("SELECT * FROM event_attendees WHERE event_id = ? ORDER BY required DESC, created_at").all(eventId);
  return (rows as any[]).map(rowToAttendee);
}

export function getEventsForAgent(agentId: string, db?: Database): EventAttendee[] {
  db = db || getDatabase();
  const rows = db.query(
    `SELECT a.* FROM event_attendees a
     INNER JOIN events e ON e.id = a.event_id
     WHERE a.agent_id = ? AND e.status != 'cancelled'
     ORDER BY e.start_at`,
  ).all(agentId);
  return (rows as any[]).map(rowToAttendee);
}

export function updateAttendee(id: string, input: UpdateAttendeeInput, db?: Database): EventAttendee {
  db = db || getDatabase();
  const existing = getAttendee(id, db);
  if (!existing) throw new NotFoundError("EventAttendee", id);

  const newStatus = input.status ?? existing.status;
  db.run(
    `UPDATE event_attendees SET status = ?, response_comment = ?, required = ?, responded_at = CASE WHEN ? IS NOT NULL AND responded_at IS NULL THEN datetime('now') ELSE responded_at END WHERE id = ?`,
    [newStatus, input.response_comment !== undefined ? input.response_comment : existing.response_comment, input.required !== undefined ? (input.required ? 1 : 0) : (existing.required ? 1 : 0), newStatus, id]
  );

  return getAttendee(id, db)!;
}

export function deleteAttendee(id: string, db?: Database): boolean {
  db = db || getDatabase();
  const result = db.run(`DELETE FROM event_attendees WHERE id = ?`, [id]);
  return result.changes > 0;
}

export function removeAttendeesFromEvent(eventId: string, db?: Database): boolean {
  db = db || getDatabase();
  const result = db.run(`DELETE FROM event_attendees WHERE event_id = ?`, [eventId]);
  return result.changes > 0;
}
