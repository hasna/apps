import { getDatabase } from "./schema.js";

export interface TimelineEvent {
  id: string;
  session_id: string;
  event_type: string;
  details: string; // JSON string
  timestamp: string;
}

export function logEvent(sessionId: string, eventType: string, details: Record<string, unknown> = {}): void {
  const db = getDatabase();
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO session_events (id, session_id, event_type, details) VALUES (?, ?, ?, ?)"
  ).run(id, sessionId, eventType, JSON.stringify(details));
}

export function getTimeline(sessionId: string, limit = 100): TimelineEvent[] {
  const db = getDatabase();
  return db.query<TimelineEvent, [string, number]>(
    "SELECT * FROM session_events WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?"
  ).all(sessionId, limit);
}

export function clearTimeline(sessionId: string): void {
  const db = getDatabase();
  db.prepare("DELETE FROM session_events WHERE session_id = ?").run(sessionId);
}
