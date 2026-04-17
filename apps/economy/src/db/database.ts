import { SqliteAdapter as Database } from '@hasna/cloud'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { hostname } from 'os'
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

export function getMachineId(): string {
  if (process.env['ECONOMY_MACHINE_ID']) return process.env['ECONOMY_MACHINE_ID']
  const h = hostname().toLowerCase()
  if (h.startsWith('spark') || h.startsWith('apple')) return h.split('.')[0]!
  return h.split('.')[0]!
}

export function getDataDir(): string {
  const home = process.env['HOME'] || process.env['USERPROFILE'] || homedir()
  const newDir = join(home, '.hasna', 'economy')
  const oldDir = join(home, '.economy')

  // Auto-migrate old dir to new location
  if (existsSync(oldDir) && !existsSync(newDir)) {
    mkdirSync(newDir, { recursive: true })
    for (const file of readdirSync(oldDir)) {
      const oldPath = join(oldDir, file)
      if (statSync(oldPath).isFile()) {
        copyFileSync(oldPath, join(newDir, file))
      }
    }
  }

  mkdirSync(newDir, { recursive: true })
  return newDir
}

export function getDbPath(): string {
  if (process.env['HASNA_ECONOMY_DB_PATH']) return process.env['HASNA_ECONOMY_DB_PATH']
  if (process.env['ECONOMY_DB']) return process.env['ECONOMY_DB']
  return join(getDataDir(), 'economy.db')
}

export function openDatabase(dbPath?: string, skipSeed = false): Database {
  const path = dbPath ?? getDbPath()
  if (path !== ':memory:') {
    const dir = path.substring(0, path.lastIndexOf('/'))
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  const db = new Database(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
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
      source_request_id TEXT,
      machine_id TEXT DEFAULT ''
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
      request_count INTEGER DEFAULT 0,
      machine_id TEXT DEFAULT ''
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

    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      period TEXT NOT NULL,
      project_path TEXT,
      agent TEXT,
      limit_usd REAL NOT NULL,
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

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      message TEXT NOT NULL,
      email TEXT,
      category TEXT DEFAULT 'general',
      version TEXT,
      machine_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS billing_daily (
      date TEXT NOT NULL,
      provider TEXT NOT NULL,
      description TEXT DEFAULT '',
      cost_usd REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (date, provider, description)
    );

    CREATE INDEX IF NOT EXISTS idx_billing_date ON billing_daily(date);
    CREATE INDEX IF NOT EXISTS idx_billing_provider ON billing_daily(provider);
  `)

  // Migrate existing DBs: add machine_id if missing (must run before index creation)
  const cols = db.prepare(`PRAGMA table_info(requests)`).all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'machine_id')) {
    db.exec(`ALTER TABLE requests ADD COLUMN machine_id TEXT DEFAULT ''`)
    db.exec(`ALTER TABLE sessions ADD COLUMN machine_id TEXT DEFAULT ''`)
  }

  // Create indexes that depend on machine_id (after migration)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_machine ON requests(machine_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_machine ON sessions(machine_id);
  `)
}

function periodWhere(period: Period): string {
  switch (period) {
    case 'today': return `DATE(timestamp) = DATE('now')`
    case 'yesterday': return `DATE(timestamp) = DATE('now', '-1 day')`
    case 'week': return `timestamp >= DATE('now', 'weekday 0', '-7 days')`
    case 'month': return `timestamp >= DATE('now', 'start of month')`
    case 'year': return `timestamp >= DATE('now', 'start of year')`
    case 'all': return '1=1'
  }
}

function sessionPeriodWhere(period: Period): string {
  switch (period) {
    case 'today': return `DATE(started_at) = DATE('now')`
    case 'yesterday': return `DATE(started_at) = DATE('now', '-1 day')`
    case 'week': return `started_at >= DATE('now', 'weekday 0', '-7 days')`
    case 'month': return `started_at >= DATE('now', 'start of month')`
    case 'year': return `started_at >= DATE('now', 'start of year')`
    case 'all': return '1=1'
  }
}

// ── Requests ──────────────────────────────────────────────────────────────────

export function upsertRequest(db: Database, req: EconomyRequest): void {
  db.prepare(`
    INSERT OR REPLACE INTO requests
      (id, agent, session_id, model, input_tokens, output_tokens,
       cache_read_tokens, cache_create_tokens, cost_usd, duration_ms,
       timestamp, source_request_id, machine_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.id, req.agent, req.session_id, req.model,
    req.input_tokens, req.output_tokens, req.cache_read_tokens,
    req.cache_create_tokens, req.cost_usd, req.duration_ms,
    req.timestamp, req.source_request_id, req.machine_id ?? '',
  )
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function upsertSession(db: Database, session: EconomySession): void {
  db.prepare(`
    INSERT OR REPLACE INTO sessions
      (id, agent, project_path, project_name, started_at, ended_at,
       total_cost_usd, total_tokens, request_count, machine_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id, session.agent, session.project_path, session.project_name,
    session.started_at, session.ended_at ?? null,
    session.total_cost_usd, session.total_tokens, session.request_count,
    session.machine_id ?? '',
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
  if (filter.machine) { conditions.push('machine_id = ?'); params.push(filter.machine) }
  if (filter.search) {
    const q = `%${filter.search}%`
    conditions.push('(project_name LIKE ? OR agent LIKE ? OR id LIKE ?)')
    params.push(q, q, `${filter.search}%`)
  }
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

export function querySummary(db: Database, period: Period, machine?: string): CostSummary {
  const rWhere = periodWhere(period)
  const sWhere = sessionPeriodWhere(period)
  const machineClause = machine ? ` AND machine_id = '${machine.replace(/'/g, "''")}'` : ''

  const r = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as total_usd,
           COUNT(*) as requests,
           COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) as tokens
    FROM requests WHERE ${rWhere}${machineClause}
  `).get() as { total_usd: number; requests: number; tokens: number }

  const codexTotals = db.prepare(`
    SELECT COALESCE(SUM(total_cost_usd), 0) as cost_usd,
           COALESCE(SUM(total_tokens), 0) as tokens,
           COUNT(*) as sessions
    FROM sessions
    WHERE ${sWhere}${machineClause}
    AND id NOT IN (SELECT DISTINCT session_id FROM requests)
  `).get() as { cost_usd: number; tokens: number; sessions: number }

  const sessionCount = db.prepare(`SELECT COUNT(*) as sessions FROM sessions WHERE ${sWhere}${machineClause}`).get() as { sessions: number }

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

/**
 * Pick the project label from a path. Walk segments and return the first
 * one that looks like a project folder (contains a hyphen or matches known
 * project prefixes), so nested paths like `platform-alumia/packages/web`
 * get labeled `platform-alumia`, not `web`.
 */
function labelForPath(projectPath: string, projectName: string): string {
  if (projectName && projectName.trim() !== '') return projectName
  if (!projectPath) return ''
  const segments = projectPath.split('/').filter(Boolean)
  // Known project-folder prefixes — matches hasnaxyz conventions (open-*, skill-*,
  // hook-*, service-*, connect-*, platform-*, agent-*, tool-*, iapp-*, project-*, scaffold-*)
  const projectPrefix = /^(open|skill|hook|service|connect|platform|agent|tool|iapp|project|scaffold|capp)-/
  for (const seg of segments) {
    if (projectPrefix.test(seg)) return seg
  }
  // Fallback: last non-generic segment (skip common subfolder names)
  const generic = new Set(['web', 'app', 'apps', 'packages', 'src', 'lib', 'server', 'client', 'api', 'frontend', 'backend'])
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!generic.has(segments[i]!.toLowerCase())) return segments[i]!
  }
  return segments[segments.length - 1] ?? projectPath
}

export function queryProjectBreakdown(db: Database): ProjectBreakdown[] {
  const sessions = db.prepare(`
    SELECT id, project_path, project_name, total_cost_usd, started_at
    FROM sessions
    WHERE project_path != '' OR project_name != ''
  `).all() as Array<{ id: string; project_path: string; project_name: string; total_cost_usd: number; started_at: string }>

  // Group sessions by derived label
  const groups = new Map<string, { sessionIds: string[]; samplePath: string; totalCost: number; lastActive: string }>()
  for (const s of sessions) {
    const label = labelForPath(s.project_path, s.project_name)
    if (!label) continue
    const g = groups.get(label) ?? { sessionIds: [], samplePath: s.project_path, totalCost: 0, lastActive: '' }
    g.sessionIds.push(s.id)
    g.totalCost += s.total_cost_usd || 0
    if (!g.lastActive || s.started_at > g.lastActive) g.lastActive = s.started_at
    if (!g.samplePath) g.samplePath = s.project_path
    groups.set(label, g)
  }

  const result: ProjectBreakdown[] = []
  for (const [label, g] of groups.entries()) {
    // Sum requests-based cost if available, else fall back to session totals
    const placeholders = g.sessionIds.map(() => '?').join(',')
    const reqStats = placeholders.length
      ? db.prepare(`
          SELECT
            COUNT(*) as requests,
            COALESCE(SUM(cost_usd), 0) as cost_usd,
            COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) as total_tokens
          FROM requests WHERE session_id IN (${placeholders})
        `).get(...g.sessionIds) as { requests: number; cost_usd: number; total_tokens: number }
      : { requests: 0, cost_usd: 0, total_tokens: 0 }

    result.push({
      project_path: g.samplePath,
      project_name: label,
      sessions: g.sessionIds.length,
      requests: reqStats.requests,
      total_tokens: reqStats.total_tokens,
      cost_usd: reqStats.cost_usd > 0 ? reqStats.cost_usd : g.totalCost,
      last_active: g.lastActive,
    })
  }

  result.sort((a, b) => b.cost_usd - a.cost_usd)
  return result
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

// ── Goals ─────────────────────────────────────────────────────────────────────

export interface Goal {
  id: string
  period: 'day' | 'week' | 'month' | 'year'
  project_path: string | null
  agent: string | null
  limit_usd: number
  created_at: string
  updated_at: string
}

export interface GoalStatus extends Goal {
  current_spend_usd: number
  percent_used: number
  is_on_track: boolean
  is_at_risk: boolean
  is_over: boolean
}

export function upsertGoal(db: Database, goal: Goal): void {
  db.prepare(`
    INSERT OR REPLACE INTO goals
      (id, period, project_path, agent, limit_usd, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    goal.id, goal.period, goal.project_path ?? null, goal.agent ?? null,
    goal.limit_usd, goal.created_at, goal.updated_at,
  )
}

export function deleteGoal(db: Database, id: string): void {
  db.prepare(`DELETE FROM goals WHERE id = ?`).run(id)
}

export function listGoals(db: Database): Goal[] {
  return db.prepare(`SELECT * FROM goals ORDER BY created_at DESC`).all() as Goal[]
}

export function getGoalStatuses(db: Database): GoalStatus[] {
  const goals = listGoals(db)
  return goals.map(g => {
    const periodStart = g.period === 'day' ? "DATE('now')"
      : g.period === 'week' ? "DATE('now', '-7 days')"
      : g.period === 'month' ? "DATE('now', '-30 days')"
      : "DATE('now', '-365 days')"
    let spendQuery = `SELECT COALESCE(SUM(cost_usd), 0) as spend FROM requests WHERE timestamp >= ${periodStart}`
    const params: (string | null)[] = []
    if (g.project_path) {
      spendQuery += ` AND session_id IN (SELECT id FROM sessions WHERE project_path = ?)`
      params.push(g.project_path)
    }
    if (g.agent) {
      spendQuery += ` AND agent = ?`
      params.push(g.agent)
    }
    const row = db.prepare(spendQuery).get(...params) as { spend: number }
    const spend = row.spend
    const percent = g.limit_usd > 0 ? (spend / g.limit_usd) * 100 : 0
    return {
      ...g,
      current_spend_usd: spend,
      percent_used: percent,
      is_on_track: percent < 70,
      is_at_risk: percent >= 70 && percent <= 100,
      is_over: percent > 100,
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

// ── Billing (actual from provider admin APIs) ─────────────────────────────────

export interface BillingDaily {
  date: string
  provider: 'anthropic' | 'openai' | string
  description: string
  cost_usd: number
  updated_at: string
}

export function upsertBillingDaily(db: Database, row: BillingDaily): void {
  db.prepare(`
    INSERT OR REPLACE INTO billing_daily (date, provider, description, cost_usd, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(row.date, row.provider, row.description, row.cost_usd, row.updated_at)
}

export function clearBillingRange(db: Database, provider: string, fromDate: string, toDate: string): void {
  db.prepare(`DELETE FROM billing_daily WHERE provider = ? AND date >= ? AND date <= ?`).run(provider, fromDate, toDate)
}

export function queryBillingSummary(db: Database, period: Period): { total_usd: number; by_provider: Record<string, number> } {
  const where = period === 'today' ? `date = DATE('now')`
    : period === 'yesterday' ? `date = DATE('now', '-1 day')`
    : period === 'week' ? `date >= DATE('now', 'weekday 0', '-7 days')`
    : period === 'month' ? `date >= DATE('now', 'start of month')`
    : period === 'year' ? `date >= DATE('now', 'start of year')`
    : '1=1'
  const rows = db.prepare(`SELECT provider, SUM(cost_usd) as cost FROM billing_daily WHERE ${where} GROUP BY provider`).all() as Array<{ provider: string; cost: number }>
  const by_provider: Record<string, number> = {}
  let total = 0
  for (const r of rows) { by_provider[r.provider] = r.cost; total += r.cost }
  return { total_usd: total, by_provider }
}

// ── Machines ─────────────────────────────────────────────────────────────────

export interface MachineInfo {
  machine_id: string
  sessions: number
  requests: number
  total_cost_usd: number
  last_active: string
}

export function listMachines(db: Database): MachineInfo[] {
  return db.prepare(`
    SELECT
      s.machine_id,
      COUNT(DISTINCT s.id) as sessions,
      COALESCE((SELECT COUNT(*) FROM requests r WHERE r.machine_id = s.machine_id), 0) as requests,
      COALESCE(SUM(s.total_cost_usd), 0) as total_cost_usd,
      MAX(s.started_at) as last_active
    FROM sessions s
    WHERE s.machine_id != ''
    GROUP BY s.machine_id
    ORDER BY total_cost_usd DESC
  `).all() as MachineInfo[]
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
  const existing = new Set(
    (db.prepare(`SELECT model FROM model_pricing`).all() as Array<{ model: string }>).map(r => r.model)
  )
  const now = new Date().toISOString()
  for (const [model, p] of Object.entries(defaults)) {
    if (existing.has(model)) continue
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
