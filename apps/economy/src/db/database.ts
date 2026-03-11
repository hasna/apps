import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type {
  EconomyRequest,
  EconomySession,
  EconomyProject,
  Budget,
  BudgetStatus,
  CostSummary,
  ModelBreakdown,
  ProjectBreakdown,
  Period,
  SessionFilter,
} from '../types/index.js'

export function getDbPath(): string {
  return process.env['ECONOMY_DB'] ?? join(homedir(), '.economy', 'economy.db')
}

export function openDatabase(dbPath?: string, skipSeed = false): Database {
  const path = dbPath ?? getDbPath()
  if (path !== ':memory:') {
    const dir = path.substring(0, path.lastIndexOf('/'))
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  const db = new Database(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  initSchema(db)
  if (!skipSeed) {
    // Lazy import to avoid circular dep — pricing imports db, db seeds pricing
    import('../lib/pricing.js').then(({ ensurePricingSeeded }) => ensurePricingSeeded(db)).catch(() => {})
  }
  return db
}

function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      session_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_create_tokens INTEGER DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL,
      source_request_id TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      project_path TEXT DEFAULT '',
      project_name TEXT DEFAULT '',
      started_at TEXT NOT NULL,
      ended_at TEXT,
      total_cost_usd REAL DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      request_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      project_path TEXT,
      agent TEXT,
      period TEXT NOT NULL,
      limit_usd REAL NOT NULL,
      alert_at_percent INTEGER DEFAULT 80,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ingest_state (
      source TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (source, key)
    );

    CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);
    CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
    CREATE INDEX IF NOT EXISTS idx_requests_agent ON requests(agent);
    CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);

    CREATE TABLE IF NOT EXISTS model_pricing (
      model TEXT PRIMARY KEY,
      input_per_1m REAL NOT NULL DEFAULT 0,
      output_per_1m REAL NOT NULL DEFAULT 0,
      cache_read_per_1m REAL NOT NULL DEFAULT 0,
      cache_write_per_1m REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `)
}

function periodWhere(period: Period): string {
  switch (period) {
    case 'today': return `DATE(timestamp) = DATE('now')`
    case 'week': return `timestamp >= DATE('now', '-7 days')`
    case 'month': return `timestamp >= DATE('now', '-30 days')`
    case 'all': return '1=1'
  }
}

function sessionPeriodWhere(period: Period): string {
  switch (period) {
    case 'today': return `DATE(started_at) = DATE('now')`
    case 'week': return `started_at >= DATE('now', '-7 days')`
    case 'month': return `started_at >= DATE('now', '-30 days')`
    case 'all': return '1=1'
  }
}

// ── Requests ──────────────────────────────────────────────────────────────────

export function upsertRequest(db: Database, req: EconomyRequest): void {
  db.prepare(`
    INSERT OR REPLACE INTO requests
      (id, agent, session_id, model, input_tokens, output_tokens,
       cache_read_tokens, cache_create_tokens, cost_usd, duration_ms,
       timestamp, source_request_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.id, req.agent, req.session_id, req.model,
    req.input_tokens, req.output_tokens, req.cache_read_tokens,
    req.cache_create_tokens, req.cost_usd, req.duration_ms,
    req.timestamp, req.source_request_id,
  )
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function upsertSession(db: Database, session: EconomySession): void {
  db.prepare(`
    INSERT OR REPLACE INTO sessions
      (id, agent, project_path, project_name, started_at, ended_at,
       total_cost_usd, total_tokens, request_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id, session.agent, session.project_path, session.project_name,
    session.started_at, session.ended_at ?? null,
    session.total_cost_usd, session.total_tokens, session.request_count,
  )
}

export function rollupSession(db: Database, sessionId: string): void {
  db.prepare(`
    UPDATE sessions SET
      total_cost_usd = (SELECT COALESCE(SUM(cost_usd), 0) FROM requests WHERE session_id = ?),
      total_tokens   = (SELECT COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) FROM requests WHERE session_id = ?),
      request_count  = (SELECT COUNT(*) FROM requests WHERE session_id = ?),
      ended_at       = (SELECT MAX(timestamp) FROM requests WHERE session_id = ?),
      started_at     = CASE WHEN started_at = '' OR started_at IS NULL
                            THEN (SELECT MIN(timestamp) FROM requests WHERE session_id = ?)
                            ELSE started_at END
    WHERE id = ?
  `).run(sessionId, sessionId, sessionId, sessionId, sessionId, sessionId)
}

export function querySessions(db: Database, filter: SessionFilter = {}): EconomySession[] {
  const conditions: string[] = []
  const params: (string | number)[] = []
  if (filter.agent) { conditions.push('agent = ?'); params.push(filter.agent) }
  if (filter.project) { conditions.push('project_path LIKE ?'); params.push(`%${filter.project}%`) }
  if (filter.since) { conditions.push('started_at >= ?'); params.push(filter.since) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filter.limit ?? 50
  const offset = filter.offset ?? 0
  return db.prepare(`
    SELECT * FROM sessions ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as EconomySession[]
}

export function queryTopSessions(db: Database, n = 10, agent?: string): EconomySession[] {
  if (agent) {
    return db.prepare(`SELECT * FROM sessions WHERE agent = ? ORDER BY total_cost_usd DESC LIMIT ?`).all(agent, n) as EconomySession[]
  }
  return db.prepare(`SELECT * FROM sessions ORDER BY total_cost_usd DESC LIMIT ?`).all(n) as EconomySession[]
}

// ── Summary ───────────────────────────────────────────────────────────────────

export function querySummary(db: Database, period: Period): CostSummary {
  const rWhere = periodWhere(period)
  const sWhere = sessionPeriodWhere(period)

  // Cost + tokens from individual requests (Claude Code)
  const r = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as total_usd,
           COUNT(*) as requests,
           COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) as tokens
    FROM requests WHERE ${rWhere}
  `).get() as { total_usd: number; requests: number; tokens: number }

  // Sessions with no request-level tracking (e.g. Codex) — add their cost separately
  const codexTotals = db.prepare(`
    SELECT COALESCE(SUM(total_cost_usd), 0) as cost_usd,
           COALESCE(SUM(total_tokens), 0) as tokens,
           COUNT(*) as sessions
    FROM sessions
    WHERE ${sWhere}
    AND id NOT IN (SELECT DISTINCT session_id FROM requests)
  `).get() as { cost_usd: number; tokens: number; sessions: number }

  const sessionCount = db.prepare(`SELECT COUNT(*) as sessions FROM sessions WHERE ${sWhere}`).get() as { sessions: number }

  return {
    total_usd: r.total_usd + codexTotals.cost_usd,
    requests: r.requests,
    tokens: r.tokens + codexTotals.tokens,
    sessions: sessionCount.sessions,
    period,
  }
}

export function queryModelBreakdown(db: Database): ModelBreakdown[] {
  return db.prepare(`
    SELECT model, agent,
           COUNT(*) as requests,
           COALESCE(SUM(input_tokens), 0) as input_tokens,
           COALESCE(SUM(output_tokens), 0) as output_tokens,
           COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) as total_tokens,
           COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM requests GROUP BY model, agent ORDER BY cost_usd DESC
  `).all() as ModelBreakdown[]
}

export function queryProjectBreakdown(db: Database): ProjectBreakdown[] {
  return db.prepare(`
    SELECT project_path, project_name,
           COUNT(*) as sessions,
           COALESCE(SUM(total_tokens), 0) as total_tokens,
           COALESCE(SUM(request_count), 0) as requests,
           COALESCE(SUM(total_cost_usd), 0) as cost_usd,
           MAX(started_at) as last_active
    FROM sessions
    GROUP BY project_path ORDER BY cost_usd DESC
  `).all() as ProjectBreakdown[]
}

export function queryDailyBreakdown(db: Database, days = 30): Array<{ date: string; cost_usd: number; agent: string }> {
  return db.prepare(`
    SELECT DATE(timestamp) as date, agent, COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM requests
    WHERE timestamp >= DATE('now', ? || ' days')
    GROUP BY DATE(timestamp), agent
    ORDER BY date ASC
  `).all(`-${days}`) as Array<{ date: string; cost_usd: number; agent: string }>
}

// ── Projects ──────────────────────────────────────────────────────────────────

export function upsertProject(db: Database, project: EconomyProject): void {
  db.prepare(`
    INSERT OR REPLACE INTO projects (id, path, name, description, tags, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(project.id, project.path, project.name, project.description ?? null, JSON.stringify(project.tags), project.created_at)
}

export function getProject(db: Database, path: string): EconomyProject | null {
  const row = db.prepare(`SELECT * FROM projects WHERE path = ?`).get(path) as Record<string, unknown> | null
  if (!row) return null
  return { ...row, tags: JSON.parse((row['tags'] as string) ?? '[]') } as EconomyProject
}

export function listProjects(db: Database): EconomyProject[] {
  return (db.prepare(`SELECT * FROM projects ORDER BY created_at DESC`).all() as Record<string, unknown>[])
    .map(row => ({ ...row, tags: JSON.parse((row['tags'] as string) ?? '[]') }) as EconomyProject)
}

export function deleteProject(db: Database, path: string): void {
  db.prepare(`DELETE FROM projects WHERE path = ?`).run(path)
}

// ── Budgets ───────────────────────────────────────────────────────────────────

export function upsertBudget(db: Database, budget: Budget): void {
  db.prepare(`
    INSERT OR REPLACE INTO budgets
      (id, project_path, agent, period, limit_usd, alert_at_percent, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    budget.id, budget.project_path ?? null, budget.agent ?? null,
    budget.period, budget.limit_usd, budget.alert_at_percent,
    budget.created_at, budget.updated_at,
  )
}

export function listBudgets(db: Database): Budget[] {
  return db.prepare(`SELECT * FROM budgets ORDER BY created_at DESC`).all() as Budget[]
}

export function deleteBudget(db: Database, id: string): void {
  db.prepare(`DELETE FROM budgets WHERE id = ?`).run(id)
}

export function getBudgetStatuses(db: Database): BudgetStatus[] {
  const budgets = listBudgets(db)
  return budgets.map(b => {
    const periodStart = b.period === 'daily' ? "DATE('now')"
      : b.period === 'weekly' ? "DATE('now', '-7 days')"
      : "DATE('now', '-30 days')"
    let spendQuery = `SELECT COALESCE(SUM(cost_usd), 0) as spend FROM requests WHERE timestamp >= ${periodStart}`
    const params: (string | null)[] = []
    if (b.project_path) {
      spendQuery += ` AND session_id IN (SELECT id FROM sessions WHERE project_path = ?)`
      params.push(b.project_path)
    }
    if (b.agent) {
      spendQuery += ` AND agent = ?`
      params.push(b.agent)
    }
    const row = db.prepare(spendQuery).get(...params) as { spend: number }
    const spend = row.spend
    const percent = b.limit_usd > 0 ? (spend / b.limit_usd) * 100 : 0
    return {
      ...b,
      current_spend_usd: spend,
      percent_used: percent,
      is_over_limit: percent >= 100,
      is_over_alert: percent >= b.alert_at_percent,
    }
  })
}

// ── Ingest state ──────────────────────────────────────────────────────────────

export function getIngestState(db: Database, source: string, key: string): string | null {
  const row = db.prepare(`SELECT value FROM ingest_state WHERE source = ? AND key = ?`).get(source, key) as { value: string } | null
  return row?.value ?? null
}

export function setIngestState(db: Database, source: string, key: string, value: string): void {
  db.prepare(`INSERT OR REPLACE INTO ingest_state (source, key, value) VALUES (?, ?, ?)`).run(source, key, value)
}

// ── New requests since timestamp ──────────────────────────────────────────────

export function queryRequestsSince(db: Database, since: string): EconomyRequest[] {
  return db.prepare(`SELECT * FROM requests WHERE timestamp > ? ORDER BY timestamp ASC`).all(since) as EconomyRequest[]
}

// ── Model pricing ─────────────────────────────────────────────────────────────

export interface DbModelPricing {
  model: string
  input_per_1m: number
  output_per_1m: number
  cache_read_per_1m: number
  cache_write_per_1m: number
  updated_at: string
}

export function upsertModelPricing(db: Database, p: DbModelPricing): void {
  db.prepare(`
    INSERT OR REPLACE INTO model_pricing
      (model, input_per_1m, output_per_1m, cache_read_per_1m, cache_write_per_1m, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(p.model, p.input_per_1m, p.output_per_1m, p.cache_read_per_1m, p.cache_write_per_1m, p.updated_at)
}

export function getModelPricing(db: Database, model: string): DbModelPricing | null {
  return db.prepare(`SELECT * FROM model_pricing WHERE model = ?`).get(model) as DbModelPricing | null
}

export function listModelPricing(db: Database): DbModelPricing[] {
  return db.prepare(`SELECT * FROM model_pricing ORDER BY model ASC`).all() as DbModelPricing[]
}

export function deleteModelPricing(db: Database, model: string): void {
  db.prepare(`DELETE FROM model_pricing WHERE model = ?`).run(model)
}

export function seedModelPricing(db: Database, defaults: Record<string, { inputPer1M: number; outputPer1M: number; cacheReadPer1M: number; cacheWritePer1M: number }>): void {
  const existing = db.prepare(`SELECT COUNT(*) as count FROM model_pricing`).get() as { count: number }
  if (existing.count > 0) return // already seeded
  const now = new Date().toISOString()
  for (const [model, p] of Object.entries(defaults)) {
    upsertModelPricing(db, {
      model,
      input_per_1m: p.inputPer1M,
      output_per_1m: p.outputPer1M,
      cache_read_per_1m: p.cacheReadPer1M,
      cache_write_per_1m: p.cacheWritePer1M,
      updated_at: now,
    })
  }
}
