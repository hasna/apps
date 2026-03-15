// SQLite session database — tracks every terminal interaction

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const DIR = join(homedir(), ".terminal");
const DB_PATH = join(DIR, "sessions.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      cwd TEXT NOT NULL,
      provider TEXT,
      model TEXT
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      nl TEXT NOT NULL,
      command TEXT,
      output TEXT,
      exit_code INTEGER,
      tokens_used INTEGER DEFAULT 0,
      tokens_saved INTEGER DEFAULT 0,
      duration_ms INTEGER,
      model TEXT,
      cached INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_interactions_session ON interactions(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
  `);

  return db;
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export function createSession(cwd: string, provider?: string, model?: string): string {
  const id = randomUUID();
  getDb().prepare(
    "INSERT INTO sessions (id, started_at, cwd, provider, model) VALUES (?, ?, ?, ?, ?)"
  ).run(id, Date.now(), cwd, provider ?? null, model ?? null);
  return id;
}

export function endSession(sessionId: string): void {
  getDb().prepare("UPDATE sessions SET ended_at = ? WHERE id = ?").run(Date.now(), sessionId);
}

export interface SessionRow {
  id: string;
  started_at: number;
  ended_at: number | null;
  cwd: string;
  provider: string | null;
  model: string | null;
}

export function listSessions(limit: number = 20): SessionRow[] {
  return getDb().prepare(
    "SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?"
  ).all(limit) as SessionRow[];
}

export function getSession(id: string): SessionRow | null {
  return getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | null;
}

// ── Interactions ─────────────────────────────────────────────────────────────

export interface InteractionRow {
  id: number;
  session_id: string;
  nl: string;
  command: string | null;
  output: string | null;
  exit_code: number | null;
  tokens_used: number;
  tokens_saved: number;
  duration_ms: number | null;
  model: string | null;
  cached: number;
  created_at: number;
}

export function logInteraction(sessionId: string, data: {
  nl: string;
  command?: string;
  output?: string;
  exitCode?: number;
  tokensUsed?: number;
  tokensSaved?: number;
  durationMs?: number;
  model?: string;
  cached?: boolean;
}): number {
  const result = getDb().prepare(
    `INSERT INTO interactions (session_id, nl, command, output, exit_code, tokens_used, tokens_saved, duration_ms, model, cached, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    data.nl,
    data.command ?? null,
    data.output ? data.output.slice(0, 500) : null,
    data.exitCode ?? null,
    data.tokensUsed ?? 0,
    data.tokensSaved ?? 0,
    data.durationMs ?? null,
    data.model ?? null,
    data.cached ? 1 : 0,
    Date.now()
  );
  return result.lastInsertRowid as number;
}

export function updateInteraction(id: number, data: {
  command?: string;
  output?: string;
  exitCode?: number;
  tokensSaved?: number;
}): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (data.command !== undefined) { sets.push("command = ?"); vals.push(data.command); }
  if (data.output !== undefined) { sets.push("output = ?"); vals.push(data.output.slice(0, 500)); }
  if (data.exitCode !== undefined) { sets.push("exit_code = ?"); vals.push(data.exitCode); }
  if (data.tokensSaved !== undefined) { sets.push("tokens_saved = ?"); vals.push(data.tokensSaved); }
  if (sets.length === 0) return;
  vals.push(id);
  getDb().prepare(`UPDATE interactions SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function getSessionInteractions(sessionId: string): InteractionRow[] {
  return getDb().prepare(
    "SELECT * FROM interactions WHERE session_id = ? ORDER BY created_at ASC"
  ).all(sessionId) as InteractionRow[];
}

// ── Analytics ────────────────────────────────────────────────────────────────

export interface SessionStats {
  totalSessions: number;
  totalInteractions: number;
  totalTokensSaved: number;
  totalTokensUsed: number;
  cacheHitRate: number;
  avgInteractionsPerSession: number;
  errorRate: number;
}

export function getSessionStats(): SessionStats {
  const d = getDb();
  const sessions = d.prepare("SELECT COUNT(*) as c FROM sessions").get() as any;
  const interactions = d.prepare("SELECT COUNT(*) as c, SUM(tokens_saved) as saved, SUM(tokens_used) as used FROM interactions").get() as any;
  const cached = d.prepare("SELECT COUNT(*) as c FROM interactions WHERE cached = 1").get() as any;
  const errors = d.prepare("SELECT COUNT(*) as c FROM interactions WHERE exit_code IS NOT NULL AND exit_code != 0").get() as any;

  const totalInteractions = interactions.c ?? 0;
  return {
    totalSessions: sessions.c ?? 0,
    totalInteractions,
    totalTokensSaved: interactions.saved ?? 0,
    totalTokensUsed: interactions.used ?? 0,
    cacheHitRate: totalInteractions > 0 ? (cached.c ?? 0) / totalInteractions : 0,
    avgInteractionsPerSession: sessions.c > 0 ? totalInteractions / sessions.c : 0,
    errorRate: totalInteractions > 0 ? (errors.c ?? 0) / totalInteractions : 0,
  };
}

/** Close the database connection */
export function closeDb(): void {
  if (db) { db.close(); db = null; }
}
