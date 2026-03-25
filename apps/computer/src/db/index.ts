import { SqliteAdapter, type DbAdapter } from "@hasna/cloud";
import { getDbPath, getDataDir } from "@hasna/cloud";
import type { Session, ActionLog, DriverAction, SessionStatus } from "../types/index.js";

const SERVICE_NAME = "computer";

let db: DbAdapter | null = null;

/** Get or create the database via @hasna/cloud adapter */
export function getDb(): DbAdapter {
  if (db) return db;

  // Ensure data dir exists
  getDataDir(SERVICE_NAME);

  const dbPath = getDbPath(SERVICE_NAME);
  const adapter = new SqliteAdapter(dbPath);

  adapter.exec("PRAGMA journal_mode = WAL");
  adapter.exec("PRAGMA foreign_keys = ON");

  // Create tables
  adapter.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      task TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      steps INTEGER NOT NULL DEFAULT 0,
      total_tokens_in INTEGER NOT NULL DEFAULT 0,
      total_tokens_out INTEGER NOT NULL DEFAULT 0,
      total_duration_ms INTEGER NOT NULL DEFAULT 0,
      tags TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS action_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      step INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      action_data TEXT NOT NULL,
      reasoning TEXT,
      screenshot_path TEXT,
      success INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      tokens_in INTEGER,
      tokens_out INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_action_logs_session ON action_logs(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);

    -- FTS5 full-text search on sessions (task text)
    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      task, content='sessions', content_rowid='rowid'
    );

    -- FTS5 full-text search on action logs (reasoning text)
    CREATE VIRTUAL TABLE IF NOT EXISTS action_logs_fts USING fts5(
      reasoning, content='action_logs', content_rowid='id'
    );

    -- Triggers to keep FTS indexes in sync
    CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
      INSERT INTO sessions_fts(rowid, task) VALUES (NEW.rowid, NEW.task);
    END;
    CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
      INSERT INTO sessions_fts(sessions_fts, rowid, task) VALUES ('delete', OLD.rowid, OLD.task);
    END;
    CREATE TRIGGER IF NOT EXISTS action_logs_ai AFTER INSERT ON action_logs BEGIN
      INSERT INTO action_logs_fts(rowid, reasoning) VALUES (NEW.id, NEW.reasoning);
    END;
    CREATE TRIGGER IF NOT EXISTS action_logs_ad AFTER DELETE ON action_logs BEGIN
      INSERT INTO action_logs_fts(action_logs_fts, rowid, reasoning) VALUES ('delete', OLD.id, OLD.reasoning);
    END;
  `);

  db = adapter;
  return db;
}

/** Create a new session */
export async function createSession(session: Session): Promise<void> {
  const d = getDb();
  d.prepare(`
    INSERT INTO sessions (id, task, provider, model, status, steps, total_tokens_in, total_tokens_out, total_duration_ms, tags, error, created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.task,
    session.provider,
    session.model,
    session.status,
    session.steps,
    session.total_tokens_in,
    session.total_tokens_out,
    session.total_duration_ms,
    session.tags?.length ? JSON.stringify(session.tags) : null,
    session.error ?? null,
    session.created_at,
    session.completed_at ?? null
  );
}

/** Update a session */
export async function updateSession(session: Session): Promise<void> {
  const d = getDb();
  d.prepare(`
    UPDATE sessions SET status = ?, steps = ?, total_tokens_in = ?, total_tokens_out = ?,
    total_duration_ms = ?, error = ?, completed_at = ?
    WHERE id = ?
  `).run(
    session.status,
    session.steps,
    session.total_tokens_in,
    session.total_tokens_out,
    session.total_duration_ms,
    session.error ?? null,
    session.completed_at ?? null,
    session.id
  );
}

/** Log an action within a session */
export async function logAction(params: {
  session_id: string;
  step: number;
  action: DriverAction;
  reasoning: string;
  screenshot_path?: string;
  success: boolean;
  error?: string;
  duration_ms: number;
  tokens_in?: number;
  tokens_out?: number;
}): Promise<void> {
  const d = getDb();
  d.prepare(`
    INSERT INTO action_logs (session_id, step, action_type, action_data, reasoning, screenshot_path, success, error, duration_ms, tokens_in, tokens_out)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.session_id,
    params.step,
    params.action.type,
    JSON.stringify(params.action),
    params.reasoning,
    params.screenshot_path ?? null,
    params.success ? 1 : 0,
    params.error ?? null,
    params.duration_ms,
    params.tokens_in ?? null,
    params.tokens_out ?? null
  );
}

/** Get a session by ID */
export function getSession(id: string): Session | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
  if (!row) return null;
  return rowToSession(row);
}

/** List sessions */
export function listSessions(opts?: {
  status?: SessionStatus;
  tag?: string;
  limit?: number;
  offset?: number;
}): Session[] {
  const d = getDb();
  let sql = "SELECT * FROM sessions";
  const params: any[] = [];
  const conditions: string[] = [];

  if (opts?.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }
  if (opts?.tag) {
    conditions.push("tags LIKE ?");
    params.push(`%"${opts.tag}"%`);
  }
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  sql += " ORDER BY created_at DESC";

  if (opts?.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  if (opts?.offset) {
    sql += " OFFSET ?";
    params.push(opts.offset);
  }

  return (d.prepare(sql).all(...params) as any[]).map(rowToSession);
}

/** Search sessions by task text (FTS5) */
export function searchSessions(query: string, limit: number = 20): Session[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT s.* FROM sessions s
    JOIN sessions_fts fts ON s.rowid = fts.rowid
    WHERE sessions_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit) as any[];
  return rows.map(rowToSession);
}

/** Search action logs by reasoning text (FTS5) */
export function searchActionLogs(
  query: string,
  limit: number = 50
): ActionLog[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT al.* FROM action_logs al
    JOIN action_logs_fts fts ON al.id = fts.rowid
    WHERE action_logs_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit) as any[];
  return rows.map((row) => ({
    id: row.id,
    session_id: row.session_id,
    step: row.step,
    action: JSON.parse(row.action_data),
    reasoning: row.reasoning,
    screenshot_path: row.screenshot_path,
    success: !!row.success,
    error: row.error,
    duration_ms: row.duration_ms,
    tokens_in: row.tokens_in,
    tokens_out: row.tokens_out,
    created_at: row.created_at,
  }));
}

/** Get action logs for a session */
export function getActionLogs(sessionId: string): ActionLog[] {
  const d = getDb();
  const rows = d.prepare(
    "SELECT * FROM action_logs WHERE session_id = ? ORDER BY step ASC"
  ).all(sessionId) as any[];

  return rows.map((row) => ({
    id: row.id,
    session_id: row.session_id,
    step: row.step,
    action: JSON.parse(row.action_data),
    reasoning: row.reasoning,
    screenshot_path: row.screenshot_path,
    success: !!row.success,
    error: row.error,
    duration_ms: row.duration_ms,
    tokens_in: row.tokens_in,
    tokens_out: row.tokens_out,
    created_at: row.created_at,
  }));
}

/** Delete a session and its logs */
export function deleteSession(id: string): boolean {
  const d = getDb();
  d.prepare("DELETE FROM action_logs WHERE session_id = ?").run(id);
  const result = d.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  return result.changes > 0;
}

/** Get session stats */
export function getStats(): {
  total_sessions: number;
  completed: number;
  failed: number;
  total_steps: number;
  total_tokens: number;
} {
  const d = getDb();
  const row = d.prepare(`
    SELECT
      COUNT(*) as total_sessions,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(steps) as total_steps,
      SUM(total_tokens_in + total_tokens_out) as total_tokens
    FROM sessions
  `).get() as any;

  return {
    total_sessions: row.total_sessions ?? 0,
    completed: row.completed ?? 0,
    failed: row.failed ?? 0,
    total_steps: row.total_steps ?? 0,
    total_tokens: row.total_tokens ?? 0,
  };
}

function rowToSession(row: any): Session {
  return {
    id: row.id,
    task: row.task,
    provider: row.provider,
    model: row.model,
    status: row.status,
    steps: row.steps,
    total_tokens_in: row.total_tokens_in,
    total_tokens_out: row.total_tokens_out,
    total_duration_ms: row.total_duration_ms,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    error: row.error,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}
