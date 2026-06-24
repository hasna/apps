import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import type { Session, ActionLog, DriverAction, SessionStatus } from "../types/index.js";
import { calculateCost } from "../lib/pricing.js";

const SERVICE_NAME = "computer";

export interface DbAdapter {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid?: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

export function getDataDir(service = SERVICE_NAME): string {
  if (service === SERVICE_NAME && process.env["COMPUTER_DATA_DIR"]) {
    mkdirSync(process.env["COMPUTER_DATA_DIR"], { recursive: true });
    return process.env["COMPUTER_DATA_DIR"];
  }
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  const dir = join(home, ".hasna", service);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDbPath(service = SERVICE_NAME): string {
  if (service === SERVICE_NAME && process.env["COMPUTER_DB_PATH"]) {
    mkdirSync(join(process.env["COMPUTER_DB_PATH"], ".."), { recursive: true });
    return process.env["COMPUTER_DB_PATH"];
  }
  return join(getDataDir(service), `${service}.db`);
}

let db: DbAdapter | null = null;

export interface AuditEvent {
  id: string;
  event: string;
  actor?: string;
  transport: string;
  capability: string;
  action_type?: string;
  action_data?: unknown;
  decision: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface LogAuditEventParams {
  id?: string;
  event: string;
  actor?: string;
  transport: string;
  capability: string;
  action_type?: string;
  action_data?: unknown;
  decision: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export type ModelUsagePhase = "planner" | "executor" | "verifier" | "provider_native";

export interface ModelUsageEvent {
  id: string;
  run_id?: string;
  session_id?: string;
  phase: ModelUsagePhase;
  provider?: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  metadata?: Record<string, unknown>;
  created_at: string;
}

/** Get or create the local SQLite database. */
export function getDb(): DbAdapter {
  if (db) return db;

  // Ensure data dir exists
  getDataDir(SERVICE_NAME);

  const dbPath = getDbPath(SERVICE_NAME);
  const adapter = new Database(dbPath) as unknown as DbAdapter;

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

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      actor TEXT,
      transport TEXT NOT NULL,
      capability TEXT NOT NULL,
      action_type TEXT,
      action_data TEXT,
      decision TEXT NOT NULL,
      reason TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_events_transport ON audit_events(transport);
    CREATE INDEX IF NOT EXISTS idx_audit_events_capability ON audit_events(capability);
    CREATE INDEX IF NOT EXISTS idx_audit_events_decision ON audit_events(decision);

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      service TEXT NOT NULL DEFAULT 'computer',
      version TEXT,
      message TEXT NOT NULL,
      email TEXT,
      machine_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runtime_goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      definition_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      goal_id TEXT REFERENCES runtime_goals(id) ON DELETE SET NULL,
      workflow_id TEXT REFERENCES workflow_definitions(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'waiting_on_approval', 'paused', 'cancelling', 'cancelled', 'failed', 'completed', 'max_steps_exceeded')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS run_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      step_index INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'waiting_on_approval', 'paused', 'cancelling', 'cancelled', 'failed', 'completed', 'max_steps_exceeded')),
      action_json TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_run_steps_run_index ON run_steps(run_id, step_index);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);

    CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      step_id TEXT REFERENCES run_steps(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      capability TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS resource_leases (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      holder TEXT,
      status TEXT NOT NULL CHECK(status IN ('active', 'released', 'expired')),
      acquired_at TEXT NOT NULL,
      expires_at TEXT,
      released_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_resource_leases_active
      ON resource_leases(resource_type, resource_id, status, expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_leases_one_active
      ON resource_leases(resource_type, resource_id)
      WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      sha256 TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS policy_decisions (
      id TEXT PRIMARY KEY,
      run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
      capability TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_usage (
      id TEXT PRIMARY KEY,
      run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      phase TEXT NOT NULL CHECK(phase IN ('planner', 'executor', 'verifier', 'provider_native')),
      provider TEXT,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_model_usage_run ON model_usage(run_id);
    CREATE INDEX IF NOT EXISTS idx_model_usage_session ON model_usage(session_id);
    CREATE INDEX IF NOT EXISTS idx_model_usage_phase ON model_usage(phase);

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

export function closeDb(): void {
  db?.close();
  db = null;
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

export function setSessionStatus(id: string, status: SessionStatus, opts: {
  error?: string | null;
  completedAt?: string | null;
  clearError?: boolean;
  clearCompletedAt?: boolean;
} = {}): Session | null {
  const session = getSession(id);
  if (!session) return null;
  const next: Session = {
    ...session,
    status,
    error: opts.clearError ? undefined : opts.error === null ? undefined : opts.error ?? session.error,
    completed_at: opts.clearCompletedAt ? undefined : opts.completedAt === null ? undefined : opts.completedAt ?? session.completed_at,
  };
  getDb().prepare(`
    UPDATE sessions SET status = ?, error = ?, completed_at = ?
    WHERE id = ?
  `).run(next.status, next.error ?? null, next.completed_at ?? null, next.id);
  return next;
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

/** Append an audit event. Audit rows are intentionally never updated in place. */
export async function logAuditEvent(params: LogAuditEventParams): Promise<AuditEvent> {
  const event: AuditEvent = {
    id: params.id ?? randomUUID(),
    event: params.event,
    actor: params.actor,
    transport: params.transport,
    capability: params.capability,
    action_type: params.action_type,
    action_data: params.action_data,
    decision: params.decision,
    reason: params.reason,
    metadata: params.metadata,
    created_at: new Date().toISOString(),
  };
  const d = getDb();
  d.prepare(`
    INSERT INTO audit_events (id, event, actor, transport, capability, action_type, action_data, decision, reason, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.event,
    event.actor ?? null,
    event.transport,
    event.capability,
    event.action_type ?? null,
    event.action_data === undefined ? null : JSON.stringify(event.action_data),
    event.decision,
    event.reason ?? null,
    event.metadata === undefined ? null : JSON.stringify(event.metadata),
    event.created_at
  );
  return event;
}

/** List recent audit events for review and tests. */
export function listAuditEvents(opts?: {
  transport?: string;
  capability?: string;
  decision?: string;
  limit?: number;
}): AuditEvent[] {
  const d = getDb();
  let sql = "SELECT * FROM audit_events";
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (opts?.transport) {
    conditions.push("transport = ?");
    params.push(opts.transport);
  }
  if (opts?.capability) {
    conditions.push("capability = ?");
    params.push(opts.capability);
  }
  if (opts?.decision) {
    conditions.push("decision = ?");
    params.push(opts.decision);
  }
  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY created_at DESC";
  if (opts?.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }

  return (d.prepare(sql).all(...params) as any[]).map(rowToAuditEvent);
}

export function recordModelUsage(input: {
  runId?: string;
  sessionId?: string;
  phase: ModelUsagePhase;
  provider?: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  metadata?: Record<string, unknown>;
  id?: string;
}): ModelUsageEvent {
  const event: ModelUsageEvent = {
    id: input.id ?? randomUUID(),
    run_id: input.runId,
    session_id: input.sessionId,
    phase: input.phase,
    provider: input.provider,
    model: input.model,
    input_tokens: input.inputTokens ?? 0,
    output_tokens: input.outputTokens ?? 0,
    cost_usd: input.costUsd ?? calculateCost(input.model, input.inputTokens ?? 0, input.outputTokens ?? 0),
    metadata: input.metadata,
    created_at: new Date().toISOString(),
  };
  getDb().prepare(`
    INSERT INTO model_usage (id, run_id, session_id, phase, provider, model, input_tokens, output_tokens, cost_usd, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.run_id ?? null,
    event.session_id ?? null,
    event.phase,
    event.provider ?? null,
    event.model,
    event.input_tokens,
    event.output_tokens,
    event.cost_usd,
    event.metadata ? JSON.stringify(event.metadata) : null,
    event.created_at,
  );
  return event;
}

export function listModelUsage(opts: { runId?: string; sessionId?: string; phase?: ModelUsagePhase } = {}): ModelUsageEvent[] {
  let sql = "SELECT * FROM model_usage";
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.runId) {
    conditions.push("run_id = ?");
    params.push(opts.runId);
  }
  if (opts.sessionId) {
    conditions.push("session_id = ?");
    params.push(opts.sessionId);
  }
  if (opts.phase) {
    conditions.push("phase = ?");
    params.push(opts.phase);
  }
  if (conditions.length > 0) sql += ` WHERE ${conditions.join(" AND ")}`;
  sql += " ORDER BY created_at ASC";
  return (getDb().prepare(sql).all(...params) as any[]).map(rowToModelUsage);
}

export function getModelUsageSummary(opts: { runId?: string; sessionId?: string } = {}): {
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
  by_phase: Record<string, { input_tokens: number; output_tokens: number; total_tokens: number; cost_usd: number }>;
} {
  const events = listModelUsage(opts);
  const byPhase: Record<string, { input_tokens: number; output_tokens: number; total_tokens: number; cost_usd: number }> = {};
  for (const event of events) {
    byPhase[event.phase] ??= { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 };
    byPhase[event.phase]!.input_tokens += event.input_tokens;
    byPhase[event.phase]!.output_tokens += event.output_tokens;
    byPhase[event.phase]!.total_tokens += event.input_tokens + event.output_tokens;
    byPhase[event.phase]!.cost_usd += event.cost_usd;
  }
  const totalInput = events.reduce((sum, event) => sum + event.input_tokens, 0);
  const totalOutput = events.reduce((sum, event) => sum + event.output_tokens, 0);
  return {
    total_input_tokens: totalInput,
    total_output_tokens: totalOutput,
    total_tokens: totalInput + totalOutput,
    total_cost_usd: events.reduce((sum, event) => sum + event.cost_usd, 0),
    by_phase: byPhase,
  };
}

/** Get a session by ID */
export function getSession(id: string): Session | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
  if (!row) return null;
  return rowToSession(row);
}

/** Resolve a full session ID or prefix to the newest matching session. */
export function resolveSessionId(idOrPrefix: string): Session | null {
  const exact = getSession(idOrPrefix);
  if (exact) return exact;
  const d = getDb();
  const row = d.prepare(`
    SELECT * FROM sessions
    WHERE id LIKE ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(`${idOrPrefix}%`) as any;
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
export function searchSessions(query: string, limit: number = 20, offset: number = 0): Session[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT s.* FROM sessions s
    JOIN sessions_fts fts ON s.rowid = fts.rowid
    WHERE sessions_fts MATCH ?
    ORDER BY rank
    LIMIT ?
    OFFSET ?
  `).all(query, limit, offset) as any[];
  return rows.map(rowToSession);
}

/** Search action logs by reasoning text (FTS5) */
export function searchActionLogs(
  query: string,
  limit: number = 50,
  offset: number = 0,
): ActionLog[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT al.* FROM action_logs al
    JOIN action_logs_fts fts ON al.id = fts.rowid
    WHERE action_logs_fts MATCH ?
    ORDER BY rank
    LIMIT ?
    OFFSET ?
  `).all(query, limit, offset) as any[];
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
  model_usage: ReturnType<typeof getModelUsageSummary>;
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
    model_usage: getModelUsageSummary(),
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

function rowToAuditEvent(row: any): AuditEvent {
  return {
    id: row.id,
    event: row.event,
    actor: row.actor ?? undefined,
    transport: row.transport,
    capability: row.capability,
    action_type: row.action_type ?? undefined,
    action_data: parseJsonField(row.action_data),
    decision: row.decision,
    reason: row.reason ?? undefined,
    metadata: parseJsonField(row.metadata) as Record<string, unknown> | undefined,
    created_at: row.created_at,
  };
}

function rowToModelUsage(row: any): ModelUsageEvent {
  return {
    id: row.id,
    run_id: row.run_id ?? undefined,
    session_id: row.session_id ?? undefined,
    phase: row.phase,
    provider: row.provider ?? undefined,
    model: row.model,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    cost_usd: row.cost_usd,
    metadata: parseJsonField(row.metadata_json) as Record<string, unknown> | undefined,
    created_at: row.created_at,
  };
}

function parseJsonField(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
