import { randomUUID } from "node:crypto";
import { getDataDir, getDatabase } from "./schema.js";
import type { ConsoleMessage, ConsoleLevel } from "../types/index.js";
import { sanitizeBrowserDbRow } from "../lib/security.js";

export function logConsoleMessage(data: Omit<ConsoleMessage, "id" | "timestamp">): ConsoleMessage {
  const db = getDatabase();
  const id = randomUUID();
  const sanitized = sanitizeBrowserDbRow("console_log", data, getDataDir());
  db.prepare(
    "INSERT INTO console_log (id, session_id, level, message, source, line_number) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    data.session_id,
    data.level,
    sanitized.message ?? data.message,
    sanitized.source ?? null,
    data.line_number ?? null,
  );
  return getConsoleMessage(id)!;
}

export function getConsoleMessage(id: string): ConsoleMessage | null {
  const db = getDatabase();
  return db.query<ConsoleMessage, string>("SELECT * FROM console_log WHERE id = ?").get(id) ?? null;
}

export function getConsoleLog(sessionId: string, level?: ConsoleLevel): ConsoleMessage[] {
  const db = getDatabase();
  if (level) {
    return db
      .query<ConsoleMessage, [string, string]>(
        "SELECT * FROM console_log WHERE session_id = ? AND level = ? ORDER BY timestamp ASC"
      )
      .all(sessionId, level);
  }
  return db
    .query<ConsoleMessage, string>("SELECT * FROM console_log WHERE session_id = ? ORDER BY timestamp ASC")
    .all(sessionId);
}

export function clearConsoleLog(sessionId: string): void {
  const db = getDatabase();
  db.prepare("DELETE FROM console_log WHERE session_id = ?").run(sessionId);
}
