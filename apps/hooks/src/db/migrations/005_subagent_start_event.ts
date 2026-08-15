/**
 * Migration 005 — SubagentStart event support.
 *
 * The event_type CHECK constraint previously accepted seven events; Codewith
 * exposes SubagentStart (installer EVENT_MAP) and runs can legitimately carry
 * it. SQLite cannot ALTER a CHECK, so the table is rebuilt and rows copied,
 * exactly as migration 002 did for SessionStart/SessionEnd.
 */

import type { Database } from "bun:sqlite";
import { CREATE_HOOK_EVENTS_TABLE, CREATE_INDEXES } from "../schema";

export function up(db: Database): void {
  const row = db
    .query<{ sql: string | null }, [string]>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?"
    )
    .get("hook_events");

  if (!row?.sql) return;
  if (row.sql.includes("SubagentStart")) return;

  db.exec("BEGIN");
  try {
    db.exec("ALTER TABLE hook_events RENAME TO hook_events_old");
    db.exec(CREATE_HOOK_EVENTS_TABLE);
    db.exec(
      `INSERT INTO hook_events
         (id, timestamp, session_id, hook_name, event_type, tool_name, tool_input, result, error, duration_ms, project_dir, metadata)
       SELECT id, timestamp, session_id, hook_name, event_type, tool_name, tool_input, result, error, duration_ms, project_dir, metadata
       FROM hook_events_old`
    );
    db.exec("DROP TABLE hook_events_old");
    for (const idx of CREATE_INDEXES) {
      db.exec(idx);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
