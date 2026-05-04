// SQLite session database — tracks every terminal interaction
// @ts-ignore — bun:sqlite is a Bun built-in
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { getTerminalDir } from "./paths.js";

const DIR = getTerminalDir();
const DB_PATH = process.env.HASNA_TERMINAL_DB_PATH ?? process.env.TERMINAL_DB_PATH ?? join(DIR, "sessions.db");

let db: Database | null = null;

function getDb(): Database {
  if (db) return db;
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");

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

    CREATE TABLE IF NOT EXISTS corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      failed_command TEXT NOT NULL,
      error_output TEXT,
      corrected_command TEXT NOT NULL,
      worked INTEGER DEFAULT 1,
      error_type TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      command TEXT NOT NULL,
      raw_output_path TEXT,
      compressed_summary TEXT,
      tokens_raw INTEGER DEFAULT 0,
      tokens_compressed INTEGER DEFAULT 0,
      provider TEXT,
      model TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_corrections_prompt ON corrections(prompt);

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      message TEXT NOT NULL,
      email TEXT,
      category TEXT DEFAULT 'general',
      version TEXT,
      machine_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
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
  const lastId = getDb().prepare("SELECT last_insert_rowid() as id").get() as any;
  return lastId?.id ?? 0;
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

/** Get economy stats for a specific session */
export function getSessionEconomy(sessionId: string): {
  totalCalls: number;
  tokensSaved: number;
  tokensUsed: number;
  aiCalls: number;
  avgLatencyMs: number;
  savingsUsd: { opus: number; sonnet: number; haiku: number };
  tools: Record<string, { calls: number; tokensSaved: number }>;
} {
  const d = getDb();
  const rows = d.prepare(
    "SELECT nl, tokens_saved, tokens_used, duration_ms FROM interactions WHERE session_id = ?"
  ).all(sessionId) as { nl: string; tokens_saved: number; tokens_used: number; duration_ms: number | null }[];

  const tools: Record<string, { calls: number; tokensSaved: number }> = {};
  let totalSaved = 0, totalUsed = 0, aiCalls = 0, totalLatency = 0, latencyCount = 0;

  for (const r of rows) {
    totalSaved += r.tokens_saved ?? 0;
    totalUsed += r.tokens_used ?? 0;
    if (r.tokens_used > 0) aiCalls++;
    if (r.duration_ms) { totalLatency += r.duration_ms; latencyCount++; }

    // Extract tool name from nl field: [mcp:toolname] command
    const toolMatch = r.nl.match(/^\[mcp:(\w+)\]/);
    const tool = toolMatch?.[1] ?? "cli";
    if (!tools[tool]) tools[tool] = { calls: 0, tokensSaved: 0 };
    tools[tool].calls++;
    tools[tool].tokensSaved += r.tokens_saved ?? 0;
  }

  // Savings at consumer model rates (×5 turns before compaction)
  const multiplied = totalSaved * 5;
  return {
    totalCalls: rows.length,
    tokensSaved: totalSaved,
    tokensUsed: totalUsed,
    aiCalls,
    avgLatencyMs: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
    savingsUsd: {
      opus: (multiplied * 15) / 1_000_000,
      sonnet: (multiplied * 3) / 1_000_000,
      haiku: (multiplied * 0.8) / 1_000_000,
    },
    tools,
  };
}

// ── Corrections ─────────────────────────────────────────────────────────────

/** Record a correction: command failed, then AI retried with a better one */
export function recordCorrection(
  prompt: string,
  failedCommand: string,
  errorOutput: string,
  correctedCommand: string,
  worked: boolean,
  errorType?: string,
): void {
  getDb().prepare(
    "INSERT INTO corrections (prompt, failed_command, error_output, corrected_command, worked, error_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(prompt, failedCommand, errorOutput?.slice(0, 2000) ?? "", correctedCommand, worked ? 1 : 0, errorType ?? null, Date.now());
}

/** Find similar corrections for a prompt — used to inject as negative examples */
export function findSimilarCorrections(prompt: string, limit: number = 5): { failed_command: string; corrected_command: string; error_type: string }[] {
  // Simple keyword matching — extract significant words from prompt
  const words = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (words.length === 0) return [];

  // Search corrections where the prompt shares keywords
  const all = getDb().prepare(
    "SELECT prompt, failed_command, corrected_command, error_type FROM corrections WHERE worked = 1 ORDER BY created_at DESC LIMIT 100"
  ).all() as any[];

  return all
    .filter(c => {
      const cWords = c.prompt.toLowerCase().split(/\s+/);
      const overlap = words.filter((w: string) => cWords.some((cw: string) => cw.includes(w) || w.includes(cw)));
      return overlap.length >= Math.min(2, words.length);
    })
    .slice(0, limit)
    .map(c => ({ failed_command: c.failed_command, corrected_command: c.corrected_command, error_type: c.error_type ?? "unknown" }));
}

// ── Output tracking ─────────────────────────────────────────────────────────

/** Record a compressed output for audit trail */
export function recordOutput(
  command: string,
  rawOutputPath: string | null,
  compressedSummary: string,
  tokensRaw: number,
  tokensCompressed: number,
  provider?: string,
  model?: string,
  sessionId?: string,
): void {
  getDb().prepare(
    "INSERT INTO outputs (session_id, command, raw_output_path, compressed_summary, tokens_raw, tokens_compressed, provider, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(sessionId ?? null, command, rawOutputPath ?? null, compressedSummary?.slice(0, 5000) ?? "", tokensRaw, tokensCompressed, provider ?? null, model ?? null, Date.now());
}

/** Prune sessions and interactions older than N days */
export function pruneSessions(olderThanDays: number = 90): { sessionsDeleted: number; interactionsDeleted: number } {
  const d = getDb();
  const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
  const oldSessions = d.prepare("SELECT id FROM sessions WHERE started_at < ?").all(cutoff) as { id: string }[];

  if (oldSessions.length === 0) return { sessionsDeleted: 0, interactionsDeleted: 0 };

  const ids = oldSessions.map(s => s.id);
  const placeholders = ids.map(() => "?").join(",");

  const intResult = d.prepare(`DELETE FROM interactions WHERE session_id IN (${placeholders})`).run(...ids);
  d.prepare(`DELETE FROM sessions WHERE id IN (${placeholders})`).run(...ids);

  // Also prune old corrections and outputs
  d.prepare("DELETE FROM corrections WHERE created_at < ?").run(cutoff);
  d.prepare("DELETE FROM outputs WHERE created_at < ?").run(cutoff);

  return {
    sessionsDeleted: oldSessions.length,
    interactionsDeleted: (intResult as any).changes ?? 0,
  };
}

/** Close the database connection */
export function closeDb(): void {
  if (db) { db.close(); db = null; }
}
