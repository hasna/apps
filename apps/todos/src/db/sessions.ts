import type { Database } from "bun:sqlite";
import type {
  CreateSessionInput,
  Session,
  SessionRow,
} from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

function rowToSession(row: SessionRow): Session {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

export function createSession(
  input: CreateSessionInput,
  db?: Database,
): Session {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO sessions (id, agent_id, project_id, working_dir, started_at, last_activity, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.agent_id || null,
      input.project_id || null,
      input.working_dir || null,
      timestamp,
      timestamp,
      JSON.stringify(input.metadata || {}),
    ],
  );

  return getSession(id, d)!;
}

export function getSession(id: string, db?: Database): Session | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | null;
  if (!row) return null;
  return rowToSession(row);
}

export function listSessions(db?: Database): Session[] {
  const d = db || getDatabase();
  const rows = d
    .query("SELECT * FROM sessions ORDER BY last_activity DESC")
    .all() as SessionRow[];
  return rows.map(rowToSession);
}

export function updateSessionActivity(
  id: string,
  db?: Database,
): void {
  const d = db || getDatabase();
  d.run("UPDATE sessions SET last_activity = ? WHERE id = ?", [now(), id]);
}

export function deleteSession(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM sessions WHERE id = ?", [id]);
  return result.changes > 0;
}
