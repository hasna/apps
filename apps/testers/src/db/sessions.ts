// Session database layer — stores session records exported from the Chrome extension.

import { getDatabase, now, uuid, resolvePartialId } from "./database.js";

export interface SessionInput {
  sessionId?: string; // extension's UUID, or generate one
  tabId: number;
  url?: string;
  title?: string;
  entries: string; // JSON array
  entryCount: number;
  errorCount?: number;
  consoleCount?: number;
  navCount?: number;
  status: "live" | "saved" | "exported";
  startTime: string;
  endTime?: string;
}

export function createSession(input: SessionInput) {
  const db = getDatabase();
  const id = input.sessionId ?? uuid();
  const timestamp = now();

  db.query(`
    INSERT INTO sessions (id, tab_id, url, title, entries, entry_count, error_count, console_count, nav_count, status, start_time, end_time, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.tabId,
    input.url ?? null,
    input.title ?? null,
    input.entries,
    input.entryCount,
    input.errorCount ?? 0,
    input.consoleCount ?? 0,
    input.navCount ?? 0,
    input.status,
    input.startTime,
    input.endTime ?? null,
    timestamp,
  );

  return getSession(id)!;
}

export function getSession(id: string): Session | null {
  const db = getDatabase();
  let row = db.query("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | null;
  if (row) return sessionFromRow(row);

  const fullId = resolvePartialId("sessions", id);
  if (fullId) {
    row = db.query("SELECT * FROM sessions WHERE id = ?").get(fullId) as SessionRow | null;
    if (row) return sessionFromRow(row);
  }

  return null;
}

export function listSessions(limit = 50, offset = 0): Session[] {
  const db = getDatabase();
  const rows = db
    .query("SELECT * FROM sessions ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as SessionRow[];
  return rows.map(sessionFromRow);
}

export function deleteSession(id: string): boolean {
  const db = getDatabase();
  const result = db.query("DELETE FROM sessions WHERE id = ?").run(id);
  return result.changes > 0;
}

export function searchSessions(query: string, limit = 20): Session[] {
  const db = getDatabase();
  const rows = db
    .query("SELECT * FROM sessions WHERE url LIKE ? OR title LIKE ? ORDER BY created_at DESC LIMIT ?")
    .all(`%${query}%`, `%${query}%`, limit) as SessionRow[];
  return rows.map(sessionFromRow);
}

export function countSessions(): number {
  const db = getDatabase();
  const row = db.query("SELECT COUNT(*) as count FROM sessions").get() as { count: number };
  return row.count;
}

// ─── Row → App types ─────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  tab_id: number;
  url: string | null;
  title: string | null;
  entries: string;
  entry_count: number;
  error_count: number;
  console_count: number;
  nav_count: number;
  status: string;
  start_time: string;
  end_time: string | null;
  created_at: string;
}

export interface Session {
  id: string;
  tabId: number;
  url: string | null;
  title: string | null;
  entries: unknown[];
  entryCount: number;
  errorCount: number;
  consoleCount: number;
  navCount: number;
  status: string;
  startTime: string;
  endTime: string | null;
  createdAt: string;
}

function sessionFromRow(row: SessionRow): Session {
  return {
    id: row.id,
    tabId: row.tab_id,
    url: row.url,
    title: row.title,
    entries: JSON.parse(row.entries),
    entryCount: row.entry_count,
    errorCount: row.error_count,
    consoleCount: row.console_count,
    navCount: row.nav_count,
    status: row.status,
    startTime: row.start_time,
    endTime: row.end_time,
    createdAt: row.created_at,
  };
}
