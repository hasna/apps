import { SqliteAdapter as Database } from './sqlite-adapter.js'
import { execFileSync } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { hostname, platform } from 'os'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { dataDir } from '@hasna/paths'
import type {
  EconomyRequest,
  EconomySession,
  EconomyProject,
  CostCenter,
  CostCenterBreakdown,
  CostCenterKind,
  Budget,
  BudgetStatus,
  CostSummary,
  ZeroCostModelBreakdown,
  ModelBreakdown,
  ProjectBreakdown,
  AgentBreakdown,
  AccountBreakdown,
  Period,
  Agent,
  SessionFilter,
} from '../types/index.js'

function normalizeMachineId(value: string | undefined | null): string | null {
  const id = value?.trim().toLowerCase().split('.')[0]
  return id && id.length > 0 ? id : null
}

function macHostMachineId(): string | null {
  if (platform() !== 'darwin') return null
  for (const key of ['LocalHostName', 'ComputerName', 'HostName']) {
    try {
      const value = execFileSync('/usr/sbin/scutil', ['--get', key], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1000,
      })
      const id = normalizeMachineId(value)
      if (id && id !== 'mac' && id !== 'localhost') return id
    } catch {
      // Optional macOS identity fallback only.
    }
  }
  return null
}

export function getMachineId(): string {
  const envMachine = normalizeMachineId(process.env['ECONOMY_MACHINE_ID'])
  if (envMachine) return envMachine
  const hostMachine = normalizeMachineId(hostname()) ?? 'unknown'
  if (hostMachine === 'mac' || hostMachine === 'localhost') return macHostMachineId() ?? hostMachine
  return hostMachine
}

/**
 * Resolve the user's home directory: $HOME, then $USERPROFILE (Windows), then
 * the OS user database. A home that cannot be resolved is a hard error — never
 * a literal "~" path (relative to cwd) and never an "undefined"-prefixed path.
 */
export function getHomeDir(): string {
  const home = process.env['HOME'] || process.env['USERPROFILE'] || homedir()
  if (!home) throw new Error('Could not resolve the user home directory')
  return home
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for economy.
 * This is the forward-looking home the XDG migration (hotfixes plan
 * `0f49f56a`, task P3.3) moves the store toward: `~/.local/share/hasna/economy`
 * on Linux, `~/Library/Application Support/Hasna/economy` on macOS. The home
 * override mirrors the pre-existing $HOME-first resolution so the resolver
 * follows the same home the legacy path does.
 */
export function getResolverDataRoot(): string {
  return dataDir({
    app: 'economy',
    home: process.env['HOME'] || process.env['USERPROFILE'] || undefined,
  })
}

/** The legacy (pre-XDG) data root: ~/.hasna/economy */
export function getLegacyDataRoot(): string {
  return join(getHomeDir(), '.hasna', 'economy')
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective data
 * root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`economy.db` exists). A machine that only redirects another kind (e.g.
 * cache to tmpfs) must NOT have its data home moved, and a live store at the
 * legacy home must never become invisible on upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME
  if (typeof dataOverride === 'string' && dataOverride.trim().length > 0) return true
  return existsSync(join(resolved, 'economy.db'))
}

/** The exact-app override root, when set: `HASNA_ECONOMY_HOME`, then `ECONOMY_HOME`. */
export function getExactDataRoot(): string | undefined {
  const dir = process.env['HASNA_ECONOMY_HOME'] ?? process.env['ECONOMY_HOME']
  if (dir && dir.trim()) return dir.trim()
  return undefined
}

/**
 * The effective data root for economy: an exact-app override
 * (`HASNA_ECONOMY_HOME`, then `ECONOMY_HOME`) wins unconditionally; otherwise
 * the resolver (XDG) data root once adopted; otherwise the legacy
 * `~/.hasna/economy` default — an existing store never becomes invisible on
 * upgrade. The store path (`HASNA_ECONOMY_DB_PATH` / `ECONOMY_DB`) is layered
 * on top of this by `getDbPath`, so an explicit store path always wins
 * regardless. The legacy `~/.economy` files are auto-migrated into the
 * effective root, preserving the historical behavior.
 */
export function getDataDir(): string {
  const exact = getExactDataRoot()
  const effective = exact
    ? resolve(exact)
    : adoptResolverDataRoot(getResolverDataRoot())
      ? resolve(getResolverDataRoot())
      : getLegacyDataRoot()
  const oldDir = join(getHomeDir(), '.economy')

  // Auto-migrate old dir to the effective data root
  if (existsSync(oldDir) && !existsSync(effective)) {
    mkdirSync(effective, { recursive: true })
    for (const file of readdirSync(oldDir)) {
      const oldPath = join(oldDir, file)
      if (statSync(oldPath).isFile()) {
        copyFileSync(oldPath, join(effective, file))
      }
    }
  }

  mkdirSync(effective, { recursive: true })
  return effective
}

export function getDbPath(): string {
  if (process.env['HASNA_ECONOMY_DB_PATH']) return process.env['HASNA_ECONOMY_DB_PATH']
  if (process.env['ECONOMY_DB']) return process.env['ECONOMY_DB']
  return join(getDataDir(), 'economy.db')
}

function isSqliteBusyError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown }
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  const message = typeof candidate.message === 'string' ? candidate.message : String(error)
  return code === 'SQLITE_BUSY' ||
    code === 'SQLITE_BUSY_RECOVERY' ||
    /database is locked|SQLITE_BUSY/i.test(message)
}

function retryDelayMs(attempt: number): number {
  return Math.min(1000, 50 * (2 ** attempt))
}

function withSqliteBusyRetry<T>(operation: () => T, context: string): T {
  const maxAttempts = 8
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return operation()
    } catch (error) {
      if (!isSqliteBusyError(error)) throw error
      lastError = error
      if (attempt === maxAttempts - 1) break
      Bun.sleepSync(retryDelayMs(attempt))
    }
  }
  throw new Error(
    `SQLite database is locked after ${maxAttempts} attempts while ${context}. Another economy sync/merge may be recovering the database; retry shortly.`,
    { cause: lastError },
  )
}

export function openDatabase(dbPath?: string, skipSeed = false): Database {
  const path = dbPath ?? getDbPath()
  if (path !== ':memory:') {
    const dir = path.substring(0, path.lastIndexOf('/'))
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  const db = withSqliteBusyRetry(() => {
    const opened = new Database(path)
    try {
      opened.exec('PRAGMA busy_timeout = 10000')
      opened.exec('PRAGMA journal_mode = WAL')
      opened.exec('PRAGMA foreign_keys = ON')
      initSchema(opened)
      return opened
    } catch (error) {
      try { opened.close() } catch { /* best effort */ }
      throw error
    }
  }, `opening ${path}`)
  if (!skipSeed) {
    // Lazy import to avoid circular dep — pricing imports db, db seeds pricing
    import('../lib/pricing.js').then(({ ensurePricingSeeded }) => ensurePricingSeeded(db)).catch(() => {})
  }
  return db
}

function quoteSqlIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

function hasColumn(db: Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${quoteSqlIdent(table)})`).all() as Array<{ name: string }>
  return columns.some(c => c.name === column)
}

function addColumnIfMissing(db: Database, table: string, column: string, definition: string): boolean {
  if (hasColumn(db, table, column)) return false
  try {
    db.exec(`ALTER TABLE ${quoteSqlIdent(table)} ADD COLUMN ${quoteSqlIdent(column)} ${definition}`)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/duplicate column name/i.test(message)) return true
    throw error
  }
}

function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_centers (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      repo_path TEXT,
      labels_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      session_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_create_tokens INTEGER DEFAULT 0,
      cache_create_5m_tokens INTEGER DEFAULT 0,
      cache_create_1h_tokens INTEGER DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL,
      source_request_id TEXT,
      machine_id TEXT DEFAULT '',
      cost_center_id TEXT,
      account_key TEXT DEFAULT '',
      account_tool TEXT DEFAULT '',
      account_name TEXT DEFAULT '',
      account_email TEXT DEFAULT '',
      account_source TEXT DEFAULT ''
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
      machine_id TEXT DEFAULT '',
      cost_center_id TEXT,
      account_key TEXT DEFAULT '',
      account_tool TEXT DEFAULT '',
      account_name TEXT DEFAULT '',
      account_email TEXT DEFAULT '',
      account_source TEXT DEFAULT ''
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
      cost_center_id TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_cost_centers_kind ON cost_centers(kind);

    CREATE TABLE IF NOT EXISTS model_pricing (
      model TEXT PRIMARY KEY,
      input_per_1m REAL NOT NULL DEFAULT 0,
      output_per_1m REAL NOT NULL DEFAULT 0,
      cache_read_per_1m REAL NOT NULL DEFAULT 0,
      cache_write_per_1m REAL NOT NULL DEFAULT 0,
      cache_write_1h_per_1m REAL NOT NULL DEFAULT 0,
      cache_storage_per_1m_hour REAL NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      agent TEXT,
      provider TEXT NOT NULL,
      plan TEXT NOT NULL,
      monthly_fee_usd REAL NOT NULL DEFAULT 0,
      included_usage_usd REAL NOT NULL DEFAULT 0,
      billing_cycle_start TEXT,
      reset_policy TEXT DEFAULT 'monthly',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_snapshots (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      date TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL DEFAULT 0,
      unit TEXT DEFAULT '',
      machine_id TEXT DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS savings_daily (
      date TEXT NOT NULL,
      agent TEXT DEFAULT '',
      api_equivalent_usd REAL NOT NULL DEFAULT 0,
      subscription_fee_usd REAL NOT NULL DEFAULT 0,
      included_consumed_usd REAL NOT NULL DEFAULT 0,
      on_demand_usd REAL NOT NULL DEFAULT 0,
      saved_usd REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (date, agent)
    );

    CREATE TABLE IF NOT EXISTS machines (
      machine_id TEXT PRIMARY KEY,
      hostname TEXT NOT NULL,
      last_seen_at TEXT,
      last_push_at TEXT,
      last_pull_at TEXT,
      economy_version TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_usage_agent_date ON usage_snapshots(agent, date);
    CREATE INDEX IF NOT EXISTS idx_savings_date ON savings_daily(date);
  `)

  // Migrate existing DBs. Column adds tolerate another process performing the
  // same migration between the PRAGMA check and ALTER TABLE.
  addColumnIfMissing(db, 'requests', 'machine_id', `TEXT DEFAULT ''`)
  addColumnIfMissing(db, 'sessions', 'machine_id', `TEXT DEFAULT ''`)
  if (addColumnIfMissing(db, 'cost_centers', 'updated_at', `TEXT DEFAULT ''`)) {
    db.exec(`UPDATE cost_centers SET updated_at = created_at WHERE updated_at = '' OR updated_at IS NULL`)
  }
  addColumnIfMissing(db, 'requests', 'cost_center_id', `TEXT`)
  addColumnIfMissing(db, 'sessions', 'cost_center_id', `TEXT`)
  addColumnIfMissing(db, 'budgets', 'cost_center_id', `TEXT`)
  if (addColumnIfMissing(db, 'requests', 'cache_create_5m_tokens', 'INTEGER DEFAULT 0')) {
    db.exec(`UPDATE requests SET cache_create_5m_tokens = cache_create_tokens WHERE cache_create_5m_tokens = 0`)
  }
  addColumnIfMissing(db, 'requests', 'cache_create_1h_tokens', 'INTEGER DEFAULT 0')
  addColumnIfMissing(db, 'requests', 'cost_basis', `TEXT DEFAULT 'estimated'`)
  addColumnIfMissing(db, 'requests', 'attribution_tag', `TEXT DEFAULT ''`)
  if (addColumnIfMissing(db, 'requests', 'updated_at', `TEXT DEFAULT ''`)) {
    db.exec(`UPDATE requests SET updated_at = timestamp WHERE updated_at = '' OR updated_at IS NULL`)
  }
  addColumnIfMissing(db, 'requests', 'synced_at', `TEXT DEFAULT ''`)
  for (const column of ['account_key', 'account_tool', 'account_name', 'account_email', 'account_source']) {
    addColumnIfMissing(db, 'requests', column, `TEXT DEFAULT ''`)
  }

  addColumnIfMissing(db, 'sessions', 'attribution_tag', `TEXT DEFAULT ''`)
  if (addColumnIfMissing(db, 'sessions', 'updated_at', `TEXT DEFAULT ''`)) {
    db.exec(`UPDATE sessions SET updated_at = started_at WHERE updated_at = '' OR updated_at IS NULL`)
  }
  addColumnIfMissing(db, 'sessions', 'synced_at', `TEXT DEFAULT ''`)
  for (const column of ['account_key', 'account_tool', 'account_name', 'account_email', 'account_source']) {
    addColumnIfMissing(db, 'sessions', column, `TEXT DEFAULT ''`)
  }

  addColumnIfMissing(db, 'model_pricing', 'cache_write_1h_per_1m', 'REAL NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'model_pricing', 'cache_storage_per_1m_hour', 'REAL NOT NULL DEFAULT 0')

  // Create indexes that depend on machine_id (after migration)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_machine ON requests(machine_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_machine ON sessions(machine_id);
    CREATE INDEX IF NOT EXISTS idx_requests_account ON requests(account_key);
    CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_key);
    CREATE INDEX IF NOT EXISTS idx_requests_cost_center ON requests(cost_center_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_cost_center ON sessions(cost_center_id);
    CREATE INDEX IF NOT EXISTS idx_budgets_cost_center ON budgets(cost_center_id);
    CREATE INDEX IF NOT EXISTS idx_cost_centers_kind ON cost_centers(kind);
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

function requestPeriodWhere(period: Period): string {
  switch (period) {
    case 'today': return `DATE(timestamp) = DATE('now')`
    case 'yesterday': return `DATE(timestamp) = DATE('now', '-1 day')`
    case 'week': return `timestamp >= DATE('now', 'weekday 0', '-7 days')`
    case 'month': return `timestamp >= DATE('now', 'start of month')`
    case 'year': return `timestamp >= DATE('now', 'start of year')`
    case 'all': return '1=1'
  }
}

// ── Requests ──────────────────────────────────────────────────────────────────

export function upsertCostCenter(db: Database, center: CostCenter): void {
  const updatedAt = center.updated_at ?? center.created_at
  db.prepare(`
    INSERT OR REPLACE INTO cost_centers
      (id, kind, name, repo_path, labels_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    center.id, center.kind, center.name,
    center.repo_path ?? null, center.labels_json ?? '{}', center.created_at, updatedAt,
  )
}

export function getCostCenter(db: Database, id: string): CostCenter | null {
  return db.prepare(`SELECT * FROM cost_centers WHERE id = ?`).get(id) as CostCenter | null
}

export function upsertRequest(db: Database, req: EconomyRequest): void {
  const now = req.updated_at ?? new Date().toISOString()
  db.prepare(`
    INSERT OR REPLACE INTO requests
      (id, agent, session_id, model, input_tokens, output_tokens,
       cache_read_tokens, cache_create_tokens, cache_create_5m_tokens,
       cache_create_1h_tokens, cost_usd, cost_basis, duration_ms, timestamp,
       source_request_id, machine_id, cost_center_id, attribution_tag, account_key, account_tool,
       account_name, account_email, account_source, updated_at, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.id, req.agent, req.session_id, req.model,
    req.input_tokens, req.output_tokens, req.cache_read_tokens,
    req.cache_create_tokens,
    req.cache_create_5m_tokens ?? req.cache_create_tokens,
    req.cache_create_1h_tokens ?? 0,
    req.cost_usd, req.cost_basis ?? 'estimated', req.duration_ms,
    req.timestamp, req.source_request_id, req.machine_id ?? '',
    req.cost_center_id ?? null,
    req.attribution_tag ?? process.env['ECONOMY_TAG'] ?? '',
    req.account_key ?? '', req.account_tool ?? '',
    req.account_name ?? '', req.account_email ?? '', req.account_source ?? '',
    now, req.synced_at ?? '',
  )
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function upsertSession(db: Database, session: EconomySession): void {
  const now = session.updated_at ?? new Date().toISOString()
  db.prepare(`
    INSERT OR REPLACE INTO sessions
      (id, agent, project_path, project_name, started_at, ended_at,
       total_cost_usd, total_tokens, request_count, machine_id, attribution_tag,
       cost_center_id, account_key, account_tool, account_name, account_email, account_source, updated_at, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id, session.agent, session.project_path, session.project_name,
    session.started_at, session.ended_at ?? null,
    session.total_cost_usd, session.total_tokens, session.request_count,
    session.machine_id ?? '',
    session.attribution_tag ?? process.env['ECONOMY_TAG'] ?? '',
    session.cost_center_id ?? null,
    session.account_key ?? '', session.account_tool ?? '',
    session.account_name ?? '', session.account_email ?? '', session.account_source ?? '',
    now, session.synced_at ?? '',
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
                            ELSE started_at END,
      account_key    = CASE WHEN account_key = '' OR account_key IS NULL
                            THEN COALESCE((SELECT account_key FROM requests WHERE session_id = ? AND account_key != '' ORDER BY timestamp DESC LIMIT 1), '')
                            ELSE account_key END,
      account_tool   = CASE WHEN account_tool = '' OR account_tool IS NULL
                            THEN COALESCE((SELECT account_tool FROM requests WHERE session_id = ? AND account_tool != '' ORDER BY timestamp DESC LIMIT 1), '')
                            ELSE account_tool END,
      account_name   = CASE WHEN account_name = '' OR account_name IS NULL
                            THEN COALESCE((SELECT account_name FROM requests WHERE session_id = ? AND account_name != '' ORDER BY timestamp DESC LIMIT 1), '')
                            ELSE account_name END,
      account_email  = CASE WHEN account_email = '' OR account_email IS NULL
                            THEN COALESCE((SELECT account_email FROM requests WHERE session_id = ? AND account_email != '' ORDER BY timestamp DESC LIMIT 1), '')
                            ELSE account_email END,
      account_source = CASE WHEN account_source = '' OR account_source IS NULL
                            THEN COALESCE((SELECT account_source FROM requests WHERE session_id = ? AND account_source != '' ORDER BY timestamp DESC LIMIT 1), '')
                            ELSE account_source END,
      cost_center_id = CASE WHEN cost_center_id = '' OR cost_center_id IS NULL
                            THEN COALESCE((SELECT cost_center_id FROM requests WHERE session_id = ? AND cost_center_id IS NOT NULL AND cost_center_id != '' ORDER BY timestamp DESC LIMIT 1), NULL)
                            ELSE cost_center_id END
    WHERE id = ?
  `).run(sessionId, sessionId, sessionId, sessionId, sessionId, sessionId, sessionId, sessionId, sessionId, sessionId, sessionId, sessionId)
}

export function querySessions(db: Database, filter: SessionFilter = {}): EconomySession[] {
  const conditions: string[] = []
  const params: (string | number)[] = []
  if (filter.agent) { conditions.push('agent = ?'); params.push(filter.agent) }
  if (filter.project) { conditions.push('project_path LIKE ?'); params.push(`%${filter.project}%`) }
  if (filter.account) {
    const q = `%${filter.account}%`
    conditions.push('(account_key LIKE ? OR account_name LIKE ? OR account_email LIKE ?)')
    params.push(q, q, q)
  }
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

export function queryTopSessions(db: Database, n = 10, agent?: string, since?: string): EconomySession[] {
  const conditions: string[] = []
  const params: (string | number)[] = []
  if (agent) { conditions.push('agent = ?'); params.push(agent) }
  if (since) { conditions.push('started_at >= ?'); params.push(since) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM sessions ${where} ORDER BY total_cost_usd DESC LIMIT ?`).all(...params, n) as EconomySession[]
}

// ── Summary ───────────────────────────────────────────────────────────────────

export function querySummary(db: Database, period: Period, machine?: string, allMachines = false, agent?: Agent): CostSummary {
  const rWhere = periodWhere(period)
  const sWhere = sessionPeriodWhere(period)
  const machineClause = !allMachines && machine ? ' AND machine_id = ?' : ''
  const agentClause = agent ? ' AND agent = ?' : ''
  const params: (string | number)[] = []
  if (!allMachines && machine) params.push(machine)
  if (agent) params.push(agent)

  const r = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as total_usd,
           COUNT(*) as requests,
           COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) as tokens
    FROM requests WHERE ${rWhere}${machineClause}${agentClause}
  `).get(...params) as { total_usd: number; requests: number; tokens: number }

  const codexTotals = db.prepare(`
    SELECT COALESCE(SUM(total_cost_usd), 0) as cost_usd,
           COALESCE(SUM(total_tokens), 0) as tokens,
           COALESCE(SUM(request_count), 0) as requests,
           COUNT(*) as sessions
    FROM sessions
    WHERE ${sWhere}${machineClause}${agentClause}
    AND id NOT IN (SELECT DISTINCT session_id FROM requests)
  `).get(...params) as { cost_usd: number; tokens: number; requests: number; sessions: number }

  const requestSessionCount = db.prepare(`
    SELECT COUNT(DISTINCT session_id) as sessions
    FROM requests
    WHERE ${rWhere}${machineClause}${agentClause}
  `).get(...params) as { sessions: number }

  return {
    total_usd: r.total_usd + codexTotals.cost_usd,
    requests: r.requests + codexTotals.requests,
    tokens: r.tokens + codexTotals.tokens,
    sessions: requestSessionCount.sessions + codexTotals.sessions,
    period,
  }
}

export function queryZeroCostTokenizedModels(db: Database, limit = 10): ZeroCostModelBreakdown[] {
  return db.prepare(`
    SELECT agent,
           model,
           COUNT(*) as requests,
           COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) as total_tokens,
           MAX(timestamp) as last_seen
    FROM requests
    WHERE cost_usd = 0
      AND (input_tokens > 0 OR output_tokens > 0 OR cache_read_tokens > 0 OR cache_create_tokens > 0)
    GROUP BY agent, model
    ORDER BY requests DESC, total_tokens DESC
    LIMIT ?
  `).all(limit) as ZeroCostModelBreakdown[]
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

export function queryAgentBreakdown(db: Database, period: Period = 'all', machine?: string): AgentBreakdown[] {
  const requestWhere = requestPeriodWhere(period)
  const machineClause = machine ? ' AND machine_id = ?' : ''
  const machineParams = machine ? [machine] : []
  const groups = new Map<string, AgentBreakdown>()

  const requestRows = db.prepare(`
    SELECT agent,
           COUNT(DISTINCT session_id) as sessions,
           COUNT(*) as requests,
           COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) as total_tokens,
           COALESCE(SUM(cost_usd), 0) as api_equivalent_usd,
           COALESCE(SUM(CASE WHEN cost_basis = 'metered_api' THEN cost_usd ELSE 0 END), 0) as metered_api_usd,
           COALESCE(SUM(CASE WHEN cost_basis = 'subscription_included' THEN cost_usd ELSE 0 END), 0) as subscription_included_usd,
           COALESCE(SUM(CASE WHEN COALESCE(cost_basis, 'estimated') = 'estimated' THEN cost_usd ELSE 0 END), 0) as estimated_usd,
           COALESCE(SUM(CASE WHEN cost_basis = 'unknown' THEN cost_usd ELSE 0 END), 0) as unknown_usd,
           COALESCE(SUM(CASE WHEN cost_basis = 'metered_api' THEN cost_usd ELSE 0 END), 0) as billable_usd,
           COALESCE(SUM(cost_usd), 0) as cost_usd,
           MAX(timestamp) as last_active
    FROM requests
    WHERE ${requestWhere}${machineClause}
    GROUP BY agent
    ORDER BY api_equivalent_usd DESC
  `).all(...machineParams) as AgentBreakdown[]

  for (const row of requestRows) {
    groups.set(row.agent, row)
  }

  const sessionWhere = sessionPeriodWhere(period)
  const sessionOnlyRows = db.prepare(`
    SELECT agent,
           COUNT(*) as sessions,
           COALESCE(SUM(request_count), 0) as requests,
           COALESCE(SUM(total_tokens), 0) as total_tokens,
           COALESCE(SUM(total_cost_usd), 0) as cost_usd,
           MAX(started_at) as last_active
    FROM sessions
    WHERE ${sessionWhere}${machineClause}
      AND id NOT IN (SELECT DISTINCT session_id FROM requests)
    GROUP BY agent
  `).all(...machineParams) as Array<{
    agent: AgentBreakdown['agent']
    sessions: number
    requests: number
    total_tokens: number
    cost_usd: number
    last_active: string
  }>

  for (const row of sessionOnlyRows) {
    const existing = groups.get(row.agent) ?? {
      agent: row.agent,
      sessions: 0,
      requests: 0,
      total_tokens: 0,
      api_equivalent_usd: 0,
      billable_usd: 0,
      metered_api_usd: 0,
      subscription_included_usd: 0,
      estimated_usd: 0,
      unknown_usd: 0,
      cost_usd: 0,
      last_active: '',
    }
    existing.sessions += row.sessions
    existing.requests += row.requests
    existing.total_tokens += row.total_tokens
    existing.api_equivalent_usd += row.cost_usd
    existing.estimated_usd += row.cost_usd
    existing.cost_usd += row.cost_usd
    if (!existing.last_active || row.last_active > existing.last_active) existing.last_active = row.last_active
    groups.set(row.agent, existing)
  }

  return [...groups.values()].sort((a, b) => b.api_equivalent_usd - a.api_equivalent_usd)
}

function pathProjectLabel(projectPath: string): string | null {
  if (!projectPath) return ''
  const segments = projectPath.split('/').filter(Boolean)
  // Known project-folder prefixes — matches hasnaxyz conventions (open-*, skill-*,
  // hook-*, service-*, connect-*, platform-*, agent-*, tool-*, iapp-*, project-*, scaffold-*)
  const projectPrefix = /^(open|skill|hook|service|connect|platform|agent|tool|iapp|project|scaffold|capp)-/
  for (const seg of segments) {
    if (projectPrefix.test(seg)) return seg
  }
  // Fallback: last non-generic segment (skip common subfolder names)
  const generic = new Set([
    'web', 'app', 'apps', 'packages', 'src', 'lib', 'server', 'client', 'api', 'frontend', 'backend',
    'home', 'users', 'workspace', 'workspaces', 'hasna',
  ])
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!generic.has(segments[i]!.toLowerCase())) return segments[i]!
  }
  return null
}

function isRepoLikeLabel(label: string): boolean {
  return /^(open|skill|hook|service|connect|platform|agent|tool|iapp|project|scaffold|capp)-/.test(label)
    || label.includes('-')
}

/**
 * Pick a repo-like project label from the path first. That keeps the same Git
 * repo grouped across machines with different home directories or display names.
 */
function labelForPath(projectPath: string, projectName: string): string {
  const pathLabel = pathProjectLabel(projectPath)
  if (pathLabel && (!projectName || projectName.trim() === '' || isRepoLikeLabel(pathLabel))) return pathLabel
  if (projectName && projectName.trim() !== '') return projectName
  if (pathLabel) return pathLabel
  return projectPath
}

function groupKeyForPath(projectPath: string, projectName: string): string {
  return labelForPath(projectPath, projectName).trim().toLowerCase()
}

type ProjectGroup = {
  label: string
  samplePath: string
  sessions: number
  requests: number
  total_tokens: number
  cost_usd: number
  last_active: string
}

function laterTimestamp(current: string, candidate: string | null): string {
  if (!candidate) return current
  return candidate > current ? candidate : current
}

/**
 * Aggregate in a fixed number of queries, independent of how many project labels
 * exist. The earlier shape ran two `id IN (<session ids>)` queries per label, and
 * neither could use an index for the scope predicate, so every label re-scanned the
 * whole requests table — 233 labels x 877k rows took ~34s on the fleet database.
 * Here requests are aggregated once per session and folded into labels in JS.
 */
function queryProjectBreakdownScoped(
  db: Database,
  requestWhere: string,
  sessionWhere: string,
  requestScopeParams: Array<string | number> = [],
  sessionScopeParams: Array<string | number> = [],
  machine?: string,
): ProjectBreakdown[] {
  const sessionMachineClause = machine ? ' AND (machine_id = ? OR id IN (SELECT DISTINCT session_id FROM requests WHERE machine_id = ?))' : ''
  const requestMachineClause = machine ? ' AND machine_id = ?' : ''
  const sessionMachineParams = machine ? [machine, machine] : []
  const requestMachineParams = machine ? [machine] : []
  const sessionOnlyMachineClause = machine ? ' AND machine_id = ?' : ''
  const sessionOnlyMachineParams = machine ? [machine] : []
  const sessions = db.prepare(`
    SELECT id, project_path, project_name
    FROM sessions
    WHERE (project_path != '' OR project_name != '')${sessionMachineClause}
  `).all(...sessionMachineParams) as Array<{ id: string; project_path: string; project_name: string }>

  // Group sessions by derived label, and index each session id back to its group so
  // the aggregate passes below fold in with a map lookup instead of their own query.
  const groups = new Map<string, ProjectGroup>()
  const groupKeyBySession = new Map<string, string>()
  for (const s of sessions) {
    const label = labelForPath(s.project_path, s.project_name)
    if (!label) continue
    const key = groupKeyForPath(s.project_path, s.project_name)
    const g = groups.get(key) ?? { label, samplePath: s.project_path, sessions: 0, requests: 0, total_tokens: 0, cost_usd: 0, last_active: '' }
    if (!g.samplePath) g.samplePath = s.project_path
    groups.set(key, g)
    groupKeyBySession.set(s.id, key)
  }

  const groupFor = (sessionId: string): ProjectGroup | undefined => {
    const key = groupKeyBySession.get(sessionId)
    return key === undefined ? undefined : groups.get(key)
  }

  const requestRows = db.prepare(`
    SELECT session_id,
           COUNT(*) as requests,
           COALESCE(SUM(cost_usd), 0) as cost_usd,
           COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) as total_tokens,
           MAX(timestamp) as last_active
    FROM requests
    WHERE ${requestWhere}${requestMachineClause}
    GROUP BY session_id
  `).all(...requestScopeParams, ...requestMachineParams) as Array<{ session_id: string; requests: number; cost_usd: number; total_tokens: number; last_active: string | null }>

  for (const row of requestRows) {
    const g = groupFor(row.session_id)
    if (!g) continue
    g.sessions += 1
    g.requests += row.requests
    g.cost_usd += row.cost_usd
    g.total_tokens += row.total_tokens
    g.last_active = laterTimestamp(g.last_active, row.last_active)
  }

  // Sessions that never produced a request row contribute their own rolled-up
  // totals. Resolve "has any request" once instead of as a NOT IN subquery per group.
  const sessionsWithRequests = new Set(
    (db.prepare(`SELECT DISTINCT session_id FROM requests`).all() as Array<{ session_id: string }>)
      .map(row => row.session_id),
  )
  const sessionOnlyRows = db.prepare(`
    SELECT id,
           COALESCE(request_count, 0) as request_count,
           COALESCE(total_tokens, 0) as total_tokens,
           COALESCE(total_cost_usd, 0) as total_cost_usd,
           started_at
    FROM sessions
    WHERE ${sessionWhere}${sessionOnlyMachineClause}
  `).all(...sessionScopeParams, ...sessionOnlyMachineParams) as Array<{ id: string; request_count: number; total_tokens: number; total_cost_usd: number; started_at: string | null }>

  for (const row of sessionOnlyRows) {
    if (sessionsWithRequests.has(row.id)) continue
    const g = groupFor(row.id)
    if (!g) continue
    g.sessions += 1
    g.requests += row.request_count
    g.total_tokens += row.total_tokens
    g.cost_usd += row.total_cost_usd
    g.last_active = laterTimestamp(g.last_active, row.started_at)
  }

  const result: ProjectBreakdown[] = []
  for (const g of groups.values()) {
    if (g.sessions === 0) continue
    result.push({
      project_path: g.samplePath,
      project_name: g.label,
      sessions: g.sessions,
      requests: g.requests,
      total_tokens: g.total_tokens,
      cost_usd: g.cost_usd,
      last_active: g.last_active,
    })
  }

  result.sort((a, b) => b.cost_usd - a.cost_usd)
  return result
}

export function queryProjectBreakdown(db: Database, period: Period = 'all', machine?: string): ProjectBreakdown[] {
  return queryProjectBreakdownScoped(
    db,
    requestPeriodWhere(period),
    sessionPeriodWhere(period),
    [],
    [],
    machine,
  )
}

function normalizeAccountEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

function accountIdentityKey(agent: string, accountKey: string, accountName: string, accountEmail: string): string {
  const identityAgent = (agent || '').trim()
  const normalizedEmail = normalizeAccountEmail(accountEmail)
  if (identityAgent && normalizedEmail) return `${identityAgent}:${normalizedEmail}`
  if (identityAgent && accountName) return `${identityAgent}:${accountName}`
  if (accountKey) return accountKey
  return identityAgent ? `${identityAgent}:unknown` : ''
}

type AccountGroup = {
  account_key: string
  account_tool: string
  account_name: string
  account_email: string | null
  account_source: string
  sessionIds: Set<string>
  requests: number
  total_tokens: number
  api_equivalent_usd: number
  metered_api_usd: number
  subscription_included_usd: number
  estimated_usd: number
  unknown_usd: number
  last_active: string
}

type AccountSourceRow = {
  session_id: string
  agent: string
  account_key: string
  account_tool: string
  account_name: string
  account_email: string
  account_source: string
  requests: number
  total_tokens: number
  cost_usd: number
  cost_basis: string
  last_active: string
}

function addAccountBreakdownRow(groups: Map<string, AccountGroup>, row: AccountSourceRow, sessionOnly: boolean): void {
  const agent = row.agent || row.account_tool
  const email = normalizeAccountEmail(row.account_email)
  const accountName = row.account_name || email || row.account_key
  const key = accountIdentityKey(agent, row.account_key, accountName, email)
  if (!key) return

  const group = groups.get(key) ?? {
    account_key: key,
    account_tool: agent,
    account_name: accountName,
    account_email: email || null,
    account_source: row.account_source || 'unknown',
    sessionIds: new Set<string>(),
    requests: 0,
    total_tokens: 0,
    api_equivalent_usd: 0,
    metered_api_usd: 0,
    subscription_included_usd: 0,
    estimated_usd: 0,
    unknown_usd: 0,
    last_active: '',
  }

  if (!group.account_email && email) group.account_email = email
  if (!group.account_name && accountName) group.account_name = accountName
  if ((!group.account_source || group.account_source === 'unknown') && row.account_source && row.account_source !== 'unknown') {
    group.account_source = row.account_source
  }
  if (row.session_id) group.sessionIds.add(row.session_id)
  group.requests += row.requests
  group.total_tokens += row.total_tokens
  group.api_equivalent_usd += row.cost_usd
  if (sessionOnly) {
    group.estimated_usd += row.cost_usd
  } else if (row.cost_basis === 'metered_api') {
    group.metered_api_usd += row.cost_usd
  } else if (row.cost_basis === 'subscription_included') {
    group.subscription_included_usd += row.cost_usd
  } else if (row.cost_basis === 'unknown') {
    group.unknown_usd += row.cost_usd
  } else {
    group.estimated_usd += row.cost_usd
  }
  if (!group.last_active || row.last_active > group.last_active) group.last_active = row.last_active
  groups.set(key, group)
}

export function queryAccountBreakdown(db: Database, period: Period = 'all', machine?: string): AccountBreakdown[] {
  const requestWhere = requestPeriodWhere(period)
  const sessionWhere = sessionPeriodWhere(period)
  const requestMachineClause = machine ? ' AND r.machine_id = ?' : ''
  const sessionMachineClause = machine ? ' AND s.machine_id = ?' : ''
  const requestMachineParams = machine ? [machine] : []
  const sessionMachineParams = machine ? [machine] : []
  const groups = new Map<string, AccountGroup>()

  const requestRows = db.prepare(`
    SELECT
      r.session_id as session_id,
      COALESCE(NULLIF(r.agent, ''), NULLIF(s.agent, ''), '') as agent,
      COALESCE(NULLIF(r.account_key, ''), NULLIF(s.account_key, ''), '') as account_key,
      COALESCE(NULLIF(r.account_tool, ''), NULLIF(s.account_tool, ''), '') as account_tool,
      COALESCE(NULLIF(r.account_name, ''), NULLIF(s.account_name, ''), '') as account_name,
      COALESCE(NULLIF(r.account_email, ''), NULLIF(s.account_email, ''), '') as account_email,
      COALESCE(NULLIF(r.account_source, ''), NULLIF(s.account_source, ''), 'unknown') as account_source,
      1 as requests,
      COALESCE(r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_create_tokens, 0) as total_tokens,
      COALESCE(r.cost_usd, 0) as cost_usd,
      COALESCE(NULLIF(r.cost_basis, ''), 'estimated') as cost_basis,
      r.timestamp as last_active
    FROM requests r
    LEFT JOIN sessions s ON s.id = r.session_id
    WHERE ${requestWhere}${requestMachineClause}
      AND (
        COALESCE(NULLIF(r.account_key, ''), NULLIF(s.account_key, ''), '') != ''
        OR COALESCE(NULLIF(r.account_tool, ''), NULLIF(s.account_tool, ''), '') != ''
        OR COALESCE(NULLIF(r.account_name, ''), NULLIF(s.account_name, ''), '') != ''
        OR COALESCE(NULLIF(r.account_email, ''), NULLIF(s.account_email, ''), '') != ''
      )
  `).all(...requestMachineParams) as AccountSourceRow[]

  for (const row of requestRows) addAccountBreakdownRow(groups, row, false)

  const sessionOnlyRows = db.prepare(`
    SELECT
      s.id as session_id,
      s.agent as agent,
      s.account_key as account_key,
      s.account_tool as account_tool,
      s.account_name as account_name,
      s.account_email as account_email,
      COALESCE(NULLIF(s.account_source, ''), 'unknown') as account_source,
      COALESCE(s.request_count, 0) as requests,
      COALESCE(s.total_tokens, 0) as total_tokens,
      COALESCE(s.total_cost_usd, 0) as cost_usd,
      'estimated' as cost_basis,
      s.started_at as last_active
    FROM sessions s
    WHERE ${sessionWhere}${sessionMachineClause}
      AND s.id NOT IN (SELECT DISTINCT session_id FROM requests)
      AND (s.account_key != '' OR s.account_tool != '' OR s.account_name != '' OR s.account_email != '')
  `).all(...sessionMachineParams) as AccountSourceRow[]

  for (const row of sessionOnlyRows) addAccountBreakdownRow(groups, row, true)

  const result = [...groups.values()].map((group) => ({
    account_key: group.account_key,
    account_tool: group.account_tool,
    account_name: group.account_name,
    account_email: group.account_email,
    account_source: group.account_source,
    sessions: group.sessionIds.size,
    requests: group.requests,
    total_tokens: group.total_tokens,
    api_equivalent_usd: group.api_equivalent_usd,
    billable_usd: group.metered_api_usd,
    metered_api_usd: group.metered_api_usd,
    subscription_included_usd: group.subscription_included_usd,
    estimated_usd: group.estimated_usd,
    unknown_usd: group.unknown_usd,
    cost_usd: group.api_equivalent_usd,
    last_active: group.last_active,
  }))

  result.sort((a, b) => b.cost_usd - a.cost_usd)
  return result
}

type CostCenterGroup = {
  cost_center_id: string
  kind: CostCenterKind
  name: string
  repo_path: string | null
  labels_json: string
  sessionIds: Set<string>
  requests: number
  total_tokens: number
  api_equivalent_usd: number
  metered_api_usd: number
  subscription_included_usd: number
  estimated_usd: number
  unknown_usd: number
  last_active: string
}

type CostCenterSourceRow = {
  cost_center_id: string
  kind: CostCenterKind | ''
  name: string
  repo_path: string | null
  labels_json: string
  session_id: string
  requests: number
  total_tokens: number
  cost_usd: number
  cost_basis: string
  last_active: string
}

function kindFromCostCenterId(id: string): CostCenterKind | '' {
  const prefix = id.split(':', 1)[0] ?? ''
  return ['loop', 'app', 'repo', 'service', 'team'].includes(prefix) ? prefix as CostCenterKind : ''
}

function addCostCenterBreakdownRow(groups: Map<string, CostCenterGroup>, row: CostCenterSourceRow, sessionOnly: boolean): void {
  if (!row.cost_center_id) return
  const derivedKind = row.kind || kindFromCostCenterId(row.cost_center_id) || 'service'
  const group = groups.get(row.cost_center_id) ?? {
    cost_center_id: row.cost_center_id,
    kind: derivedKind as CostCenterKind,
    name: row.name || row.cost_center_id,
    repo_path: row.repo_path ?? null,
    labels_json: row.labels_json || '{}',
    sessionIds: new Set<string>(),
    requests: 0,
    total_tokens: 0,
    api_equivalent_usd: 0,
    metered_api_usd: 0,
    subscription_included_usd: 0,
    estimated_usd: 0,
    unknown_usd: 0,
    last_active: '',
  }

  group.kind = derivedKind as CostCenterKind
  if (row.name) group.name = row.name
  if (row.repo_path && !group.repo_path) group.repo_path = row.repo_path
  if (row.labels_json && row.labels_json !== '{}') group.labels_json = row.labels_json
  if (row.session_id) group.sessionIds.add(row.session_id)
  group.requests += row.requests
  group.total_tokens += row.total_tokens
  group.api_equivalent_usd += row.cost_usd
  if (sessionOnly) {
    group.estimated_usd += row.cost_usd
  } else if (row.cost_basis === 'metered_api') {
    group.metered_api_usd += row.cost_usd
  } else if (row.cost_basis === 'subscription_included') {
    group.subscription_included_usd += row.cost_usd
  } else if (row.cost_basis === 'unknown') {
    group.unknown_usd += row.cost_usd
  } else {
    group.estimated_usd += row.cost_usd
  }
  if (!group.last_active || row.last_active > group.last_active) group.last_active = row.last_active
  groups.set(row.cost_center_id, group)
}

export function queryCostCenterBreakdown(
  db: Database,
  period: Period = 'all',
  filter: { kind?: CostCenterKind; machine?: string; since?: string } = {},
): CostCenterBreakdown[] {
  const requestWhere = filter.since ? 'r.timestamp >= ?' : requestPeriodWhere(period)
  const sessionWhere = filter.since ? 's.started_at >= ?' : sessionPeriodWhere(period)
  const requestMachineClause = filter.machine ? ' AND r.machine_id = ?' : ''
  const sessionMachineClause = filter.machine ? ' AND s.machine_id = ?' : ''
  const requestParams: string[] = []
  const sessionParams: string[] = []
  if (filter.since) {
    requestParams.push(filter.since)
    sessionParams.push(filter.since)
  }
  if (filter.machine) {
    requestParams.push(filter.machine)
    sessionParams.push(filter.machine)
  }
  const groups = new Map<string, CostCenterGroup>()

  const requestRows = db.prepare(`
    SELECT
      COALESCE(NULLIF(r.cost_center_id, ''), NULLIF(s.cost_center_id, '')) as cost_center_id,
      COALESCE(cc.kind, '') as kind,
      COALESCE(cc.name, COALESCE(NULLIF(r.cost_center_id, ''), NULLIF(s.cost_center_id, ''))) as name,
      cc.repo_path as repo_path,
      COALESCE(cc.labels_json, '{}') as labels_json,
      r.session_id as session_id,
      1 as requests,
      COALESCE(r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_create_tokens, 0) as total_tokens,
      COALESCE(r.cost_usd, 0) as cost_usd,
      COALESCE(NULLIF(r.cost_basis, ''), 'estimated') as cost_basis,
      r.timestamp as last_active
    FROM requests r
    LEFT JOIN sessions s ON s.id = r.session_id
    LEFT JOIN cost_centers cc ON cc.id = COALESCE(NULLIF(r.cost_center_id, ''), NULLIF(s.cost_center_id, ''))
    WHERE ${requestWhere}${requestMachineClause}
      AND COALESCE(NULLIF(r.cost_center_id, ''), NULLIF(s.cost_center_id, '')) IS NOT NULL
      AND COALESCE(NULLIF(r.cost_center_id, ''), NULLIF(s.cost_center_id, '')) != ''
  `).all(...requestParams) as CostCenterSourceRow[]

  for (const row of requestRows) addCostCenterBreakdownRow(groups, row, false)

  const sessionOnlyRows = db.prepare(`
    SELECT
      s.cost_center_id as cost_center_id,
      COALESCE(cc.kind, '') as kind,
      COALESCE(cc.name, s.cost_center_id) as name,
      cc.repo_path as repo_path,
      COALESCE(cc.labels_json, '{}') as labels_json,
      s.id as session_id,
      COALESCE(s.request_count, 0) as requests,
      COALESCE(s.total_tokens, 0) as total_tokens,
      COALESCE(s.total_cost_usd, 0) as cost_usd,
      'estimated' as cost_basis,
      s.started_at as last_active
    FROM sessions s
    LEFT JOIN cost_centers cc ON cc.id = s.cost_center_id
    WHERE ${sessionWhere}${sessionMachineClause}
      AND s.id NOT IN (SELECT DISTINCT session_id FROM requests)
      AND s.cost_center_id IS NOT NULL
      AND s.cost_center_id != ''
  `).all(...sessionParams) as CostCenterSourceRow[]

  for (const row of sessionOnlyRows) addCostCenterBreakdownRow(groups, row, true)

  const result = [...groups.values()].map((group) => ({
    cost_center_id: group.cost_center_id,
    kind: group.kind,
    name: group.name,
    repo_path: group.repo_path,
    labels_json: group.labels_json,
    sessions: group.sessionIds.size,
    requests: group.requests,
    total_tokens: group.total_tokens,
    api_equivalent_usd: group.api_equivalent_usd,
    billable_usd: group.metered_api_usd,
    metered_api_usd: group.metered_api_usd,
    subscription_included_usd: group.subscription_included_usd,
    estimated_usd: group.estimated_usd,
    unknown_usd: group.unknown_usd,
    cost_usd: group.api_equivalent_usd,
    last_active: group.last_active,
  }))

  const filtered = filter.kind ? result.filter(row => row.kind === filter.kind) : result
  filtered.sort((a, b) => b.cost_usd - a.cost_usd)
  return filtered
}

// ── since-scoped breakdown helpers ──────────────────────────────────────────
// These back the CLI `breakdown --since <date>` path. They mirror the period
// breakdowns above but filter by an ISO date lower bound so a single LocalStore
// code path can serve both period and since queries (no inline SQL in the CLI).

export function queryProjectBreakdownSince(db: Database, since: string, machine?: string): ProjectBreakdown[] {
  return queryProjectBreakdownScoped(
    db,
    'timestamp >= ?',
    'started_at >= ?',
    [since],
    [since],
    machine,
  )
}

export function queryAgentBreakdownSince(db: Database, since: string): AgentBreakdown[] {
  return db.prepare(`
    SELECT agent,
           COUNT(DISTINCT session_id) as sessions,
           COUNT(*) as requests,
           COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) as total_tokens,
           COALESCE(SUM(cost_usd), 0) as api_equivalent_usd,
           COALESCE(SUM(CASE WHEN cost_basis = 'metered_api' THEN cost_usd ELSE 0 END), 0) as billable_usd,
           COALESCE(SUM(CASE WHEN cost_basis = 'subscription_included' THEN cost_usd ELSE 0 END), 0) as subscription_included_usd,
           MAX(timestamp) as last_active
    FROM requests
    WHERE timestamp >= ?
    GROUP BY agent
    ORDER BY api_equivalent_usd DESC
  `).all(since) as AgentBreakdown[]
}

export function queryModelBreakdownSince(db: Database, since: string): ModelBreakdown[] {
  return db.prepare(`
    SELECT model, agent,
           COUNT(*) as requests,
           COALESCE(SUM(input_tokens), 0) as input_tokens,
           COALESCE(SUM(output_tokens), 0) as output_tokens,
           COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) as total_tokens,
           COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM requests WHERE timestamp >= ?
    GROUP BY model, agent ORDER BY cost_usd DESC
  `).all(since) as ModelBreakdown[]
}

export function queryAccountBreakdownSince(db: Database, since: string): AccountBreakdown[] {
  return db.prepare(`
    WITH request_rows AS (
      SELECT
        r.session_id as session_id,
        COALESCE(NULLIF(r.agent, ''), NULLIF(s.agent, ''), NULLIF(r.account_tool, ''), NULLIF(s.account_tool, ''), 'unknown') as account_agent,
        COALESCE(NULLIF(r.account_key, ''), NULLIF(s.account_key, ''), '') as raw_account_key,
        COALESCE(NULLIF(r.account_name, ''), NULLIF(s.account_name, ''), '') as raw_account_name,
        LOWER(TRIM(COALESCE(NULLIF(r.account_email, ''), NULLIF(s.account_email, ''), ''))) as raw_account_email,
        COALESCE(NULLIF(r.account_source, ''), NULLIF(s.account_source, ''), 'unknown') as account_source,
        1 as requests,
        COALESCE(r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_create_tokens, 0) as total_tokens,
        COALESCE(r.cost_usd, 0) as cost_usd,
        COALESCE(NULLIF(r.cost_basis, ''), 'estimated') as cost_basis,
        r.timestamp as last_active
      FROM requests r
      LEFT JOIN sessions s ON s.id = r.session_id
      WHERE r.timestamp >= ?
        AND (
          COALESCE(NULLIF(r.account_key, ''), NULLIF(s.account_key, ''), '') != ''
          OR COALESCE(NULLIF(r.account_tool, ''), NULLIF(s.account_tool, ''), '') != ''
          OR COALESCE(NULLIF(r.account_name, ''), NULLIF(s.account_name, ''), '') != ''
          OR COALESCE(NULLIF(r.account_email, ''), NULLIF(s.account_email, ''), '') != ''
        )
    ),
    session_only_rows AS (
      SELECT
        s.id as session_id,
        COALESCE(NULLIF(s.agent, ''), NULLIF(s.account_tool, ''), 'unknown') as account_agent,
        s.account_key as raw_account_key,
        s.account_name as raw_account_name,
        LOWER(TRIM(COALESCE(s.account_email, ''))) as raw_account_email,
        COALESCE(NULLIF(s.account_source, ''), 'unknown') as account_source,
        COALESCE(s.request_count, 0) as requests,
        COALESCE(s.total_tokens, 0) as total_tokens,
        COALESCE(s.total_cost_usd, 0) as cost_usd,
        'estimated' as cost_basis,
        s.started_at as last_active
      FROM sessions s
      WHERE s.started_at >= ?
        AND s.id NOT IN (SELECT DISTINCT session_id FROM requests)
        AND (s.account_key != '' OR s.account_tool != '' OR s.account_name != '' OR s.account_email != '')
    ),
    normalized AS (
      SELECT
        CASE
          WHEN raw_account_email != '' THEN account_agent || ':' || raw_account_email
          WHEN raw_account_name != '' THEN account_agent || ':' || raw_account_name
          ELSE raw_account_key
        END as account_key,
        account_agent as account_tool,
        raw_account_name as account_name,
        raw_account_email as account_email,
        account_source,
        session_id,
        requests,
        total_tokens,
        cost_usd,
        cost_basis,
        last_active
      FROM request_rows
      UNION ALL
      SELECT
        CASE
          WHEN raw_account_email != '' THEN account_agent || ':' || raw_account_email
          WHEN raw_account_name != '' THEN account_agent || ':' || raw_account_name
          ELSE raw_account_key
        END as account_key,
        account_agent as account_tool,
        raw_account_name as account_name,
        raw_account_email as account_email,
        account_source,
        session_id,
        requests,
        total_tokens,
        cost_usd,
        cost_basis,
        last_active
      FROM session_only_rows
    )
    SELECT account_key,
           account_tool,
           COALESCE(MAX(NULLIF(account_name, '')), MAX(NULLIF(account_email, '')), account_key) as account_name,
           NULLIF(account_email, '') as account_email,
           COALESCE(MAX(NULLIF(account_source, 'unknown')), 'unknown') as account_source,
           COUNT(DISTINCT session_id) as sessions,
           COALESCE(SUM(requests), 0) as requests,
           COALESCE(SUM(total_tokens), 0) as total_tokens,
           COALESCE(SUM(cost_usd), 0) as api_equivalent_usd,
           COALESCE(SUM(CASE WHEN cost_basis = 'metered_api' THEN cost_usd ELSE 0 END), 0) as billable_usd,
           COALESCE(SUM(CASE WHEN cost_basis = 'metered_api' THEN cost_usd ELSE 0 END), 0) as metered_api_usd,
           COALESCE(SUM(CASE WHEN cost_basis = 'subscription_included' THEN cost_usd ELSE 0 END), 0) as subscription_included_usd,
           COALESCE(SUM(CASE WHEN cost_basis NOT IN ('metered_api', 'subscription_included', 'unknown') THEN cost_usd ELSE 0 END), 0) as estimated_usd,
           COALESCE(SUM(CASE WHEN cost_basis = 'unknown' THEN cost_usd ELSE 0 END), 0) as unknown_usd,
           COALESCE(SUM(cost_usd), 0) as cost_usd,
           MAX(last_active) as last_active
    FROM normalized
    WHERE account_key != ''
    GROUP BY account_key, account_tool, account_email
    ORDER BY api_equivalent_usd DESC
  `).all(since, since) as AccountBreakdown[]
}

export function queryDailyBreakdown(db: Database, days = 30, machine?: string): Array<{ date: string; cost_usd: number; agent: string }> {
  const machineClause = machine ? ' AND machine_id = ?' : ''
  const params = machine ? [`-${days}`, machine] : [`-${days}`]
  return db.prepare(`
    SELECT DATE(timestamp) as date, agent, COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM requests
    WHERE timestamp >= DATE('now', ? || ' days')${machineClause}
    GROUP BY DATE(timestamp), agent
    ORDER BY date ASC
  `).all(...params) as Array<{ date: string; cost_usd: number; agent: string }>
}

export function queryHourlyBreakdown(db: Database, machine?: string, hours?: number): Array<{ hour: string; cost_usd: number; agent: string }> {
  const clauses = hours == null
    ? [`DATE(timestamp) = DATE('now')`]
    : [`DATETIME(timestamp) >= DATETIME('now', ?)`]
  const params: unknown[] = hours == null ? [] : [`-${hours} hours`]
  if (machine) {
    clauses.push('machine_id = ?')
    params.push(machine)
  }

  return db.prepare(`
    SELECT STRFTIME('%H', timestamp) as hour, agent, COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM requests
    WHERE ${clauses.join(' AND ')}
    GROUP BY STRFTIME('%H', timestamp), agent
    ORDER BY hour ASC
  `).all(...params) as Array<{ hour: string; cost_usd: number; agent: string }>
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
      (id, project_path, agent, cost_center_id, period, limit_usd, alert_at_percent, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    budget.id, budget.project_path ?? null, budget.agent ?? null,
    budget.cost_center_id ?? null,
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
    if (b.cost_center_id) {
      spendQuery += ` AND COALESCE(NULLIF(cost_center_id, ''), (SELECT NULLIF(s.cost_center_id, '') FROM sessions s WHERE s.id = requests.session_id)) = ?`
      params.push(b.cost_center_id)
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

// ── Feedback ──────────────────────────────────────────────────────────────────

export interface FeedbackRecord {
  message: string
  email?: string | null
  category?: string | null
  version?: string | null
  machine_id?: string | null
}

/** Persist a feedback row. Used by both the LocalStore and the serve endpoint. */
export function insertFeedback(db: Database, record: FeedbackRecord): void {
  db.prepare(
    `INSERT INTO feedback (message, email, category, version, machine_id) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    record.message,
    record.email ?? null,
    record.category ?? 'general',
    record.version ?? null,
    record.machine_id ?? null,
  )
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

/**
 * Which `billing_daily` rows belong to a period. Shared by the total and the
 * row count deliberately: a caller deciding whether a $0.00 total means "they
 * agree" or "nothing was imported" is only safe while both reads select the
 * same rows.
 */
function billingPeriodWhere(period: Period): string {
  return period === 'today' ? `date = DATE('now')`
    : period === 'yesterday' ? `date = DATE('now', '-1 day')`
    : period === 'week' ? `date >= DATE('now', 'weekday 0', '-7 days')`
    : period === 'month' ? `date >= DATE('now', 'start of month')`
    : period === 'year' ? `date >= DATE('now', 'start of year')`
    : '1=1'
}

export function queryBillingSummary(db: Database, period: Period): { total_usd: number; by_provider: Record<string, number> } {
  const rows = db.prepare(`SELECT provider, SUM(cost_usd) as cost FROM billing_daily WHERE ${billingPeriodWhere(period)} GROUP BY provider`).all() as Array<{ provider: string; cost: number }>
  const by_provider: Record<string, number> = {}
  let total = 0
  for (const r of rows) { by_provider[r.provider] = r.cost; total += r.cost }
  return { total_usd: total, by_provider }
}

/**
 * How many provider billing rows exist for a period. A $0.00 actual total is
 * ambiguous on its own — it is produced both by "billing agrees with telemetry
 * at zero" and by "billing was never imported" — and only this count separates
 * them.
 */
export function countBillingRecords(db: Database, period: Period): number {
  const row = db.prepare(`SELECT COUNT(*) as c FROM billing_daily WHERE ${billingPeriodWhere(period)}`).get() as { c: number }
  return row?.c ?? 0
}

// ── Session detail ─────────────────────────────────────────────────────────

export interface SessionDetail {
  session: Record<string, unknown>
  requests: Array<Record<string, unknown>>
}

/**
 * Fetch a single session (by exact id or id-prefix) plus its per-request rows,
 * ordered oldest-first. Returns null when no session matches. Backs the CLI
 * `session <id>` command and the MCP `get_session_detail` tool via the Store.
 */
export function getSessionDetail(db: Database, id: string): SessionDetail | null {
  const session = db.prepare(`SELECT * FROM sessions WHERE id = ? OR id LIKE ?`).get(id, `${id}%`) as Record<string, unknown> | null
  if (!session) return null
  const requests = db.prepare(`SELECT * FROM requests WHERE session_id = ? ORDER BY timestamp ASC`).all(session['id'] as string) as Array<Record<string, unknown>>
  return { session, requests }
}

// ── Machines ─────────────────────────────────────────────────────────────────

export interface MachineInfo {
  machine_id: string
  sessions: number
  requests: number
  total_cost_usd: number
  last_active: string
}

export function listMachines(db: Database, period: Period = 'all'): MachineInfo[] {
  const rWhere = requestPeriodWhere(period)
  const sWhere = sessionPeriodWhere(period)
  return db.prepare(`
    WITH request_stats AS (
      SELECT
        machine_id,
        COUNT(DISTINCT session_id) as sessions,
        COUNT(*) as requests,
        COALESCE(SUM(cost_usd), 0) as total_cost_usd,
        MAX(timestamp) as last_active
      FROM requests
      WHERE machine_id != ''
        AND ${rWhere}
      GROUP BY machine_id
    ),
    session_only_stats AS (
      SELECT
        machine_id,
        COUNT(*) as sessions,
        COALESCE(SUM(request_count), 0) as requests,
        COALESCE(SUM(total_cost_usd), 0) as total_cost_usd,
        MAX(started_at) as last_active
      FROM sessions
      WHERE machine_id != ''
        AND ${sWhere}
        AND id NOT IN (SELECT DISTINCT session_id FROM requests)
      GROUP BY machine_id
    ),
    combined AS (
      SELECT * FROM request_stats
      UNION ALL
      SELECT * FROM session_only_stats
    )
    SELECT
      machine_id,
      COALESCE(SUM(sessions), 0) as sessions,
      COALESCE(SUM(requests), 0) as requests,
      COALESCE(SUM(total_cost_usd), 0) as total_cost_usd,
      MAX(last_active) as last_active
    FROM combined
    GROUP BY machine_id
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
  cache_write_1h_per_1m?: number
  cache_storage_per_1m_hour?: number
  updated_at: string
}

export function upsertModelPricing(db: Database, p: DbModelPricing): void {
  db.prepare(`
    INSERT OR REPLACE INTO model_pricing
      (model, input_per_1m, output_per_1m, cache_read_per_1m, cache_write_per_1m, cache_write_1h_per_1m, cache_storage_per_1m_hour, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p.model,
    p.input_per_1m,
    p.output_per_1m,
    p.cache_read_per_1m,
    p.cache_write_per_1m,
    p.cache_write_1h_per_1m ?? 0,
    p.cache_storage_per_1m_hour ?? 0,
    p.updated_at,
  )
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

export function seedModelPricing(db: Database, defaults: Record<string, { inputPer1M: number; outputPer1M: number; cacheReadPer1M: number; cacheWritePer1M: number; cacheWrite1hPer1M?: number; cacheStoragePer1MHour?: number }>): void {
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
      cache_write_1h_per_1m: p.cacheWrite1hPer1M ?? 0,
      cache_storage_per_1m_hour: p.cacheStoragePer1MHour ?? 0,
      updated_at: now,
    })
  }
}

// ── Subscriptions ─────────────────────────────────────────────────────────────

export function upsertSubscription(db: Database, sub: import('../types/index.js').Subscription): void {
  db.prepare(`
    INSERT OR REPLACE INTO subscriptions
      (id, agent, provider, plan, monthly_fee_usd, included_usage_usd, billing_cycle_start, reset_policy, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sub.id, sub.agent, sub.provider, sub.plan, sub.monthly_fee_usd, sub.included_usage_usd,
    sub.billing_cycle_start, sub.reset_policy, sub.active, sub.created_at, sub.updated_at,
  )
}

export function listSubscriptions(db: Database): import('../types/index.js').Subscription[] {
  return db.prepare(`SELECT * FROM subscriptions ORDER BY provider, plan`).all() as import('../types/index.js').Subscription[]
}

export function deleteSubscription(db: Database, id: string): void {
  db.prepare(`DELETE FROM subscriptions WHERE id = ?`).run(id)
}

// ── Usage snapshots ───────────────────────────────────────────────────────────

export function upsertUsageSnapshot(
  db: Database,
  snap: Omit<import('../types/index.js').UsageSnapshot, 'id' | 'updated_at'> & { id?: string; updated_at?: string },
): void {
  const now = snap.updated_at ?? new Date().toISOString()
  const id = snap.id ?? `${snap.agent}-${snap.date}-${snap.metric}-${snap.machine_id}`
  db.prepare(`
    INSERT OR REPLACE INTO usage_snapshots (id, agent, date, metric, value, unit, machine_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, snap.agent, snap.date, snap.metric, snap.value, snap.unit, snap.machine_id, now)
}

export function queryUsageSnapshots(
  db: Database,
  opts: { agent?: string; date?: string; since?: string } = {},
): import('../types/index.js').UsageSnapshot[] {
  const conditions: string[] = []
  const params: string[] = []
  if (opts.agent) { conditions.push('agent = ?'); params.push(opts.agent) }
  if (opts.date) { conditions.push('date = ?'); params.push(opts.date) }
  if (opts.since) { conditions.push('date >= ?'); params.push(opts.since) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM usage_snapshots ${where} ORDER BY date DESC, agent, metric`).all(...params) as import('../types/index.js').UsageSnapshot[]
}

export function listMachineRegistry(db: Database): import('../types/index.js').MachineRegistry[] {
  return db.prepare(`SELECT * FROM machines ORDER BY last_seen_at DESC`).all() as import('../types/index.js').MachineRegistry[]
}

export function dedupeRequests(db: Database): number {
  const dupes = db.prepare(`
    SELECT source_request_id, agent, COALESCE(machine_id, '') as machine_id, MIN(id) as keep_id, COUNT(*) as cnt
    FROM requests
    WHERE source_request_id != '' AND source_request_id IS NOT NULL
    GROUP BY source_request_id, agent, COALESCE(machine_id, '')
    HAVING cnt > 1
  `).all() as Array<{ source_request_id: string; agent: string; machine_id: string; keep_id: string; cnt: number }>

  let removed = 0
  for (const row of dupes) {
    const result = db.prepare(`
      DELETE FROM requests
      WHERE source_request_id = ?
        AND agent = ?
        AND COALESCE(machine_id, '') = ?
        AND id != ?
    `).run(row.source_request_id, row.agent, row.machine_id, row.keep_id)
    removed += result.changes
  }
  return removed
}

// ── Bulk ingest (authed cloud backfill) ─────────────────────────────────────────
//
// Idempotent, dialect-safe importer behind the authed POST /v1/ingest route. It
// lets a fleet machine push its local rows into the shared cloud DB over
// HTTPS + API-key — the locked self_hosted architecture forbids a raw RDS DSN on
// clients, and the big time-series tables (requests/sessions) have no other write
// path, so cloud parity was otherwise impossible.
//
// Why this does NOT reuse the `INSERT OR REPLACE` upsert helpers directly: against
// Postgres the SQL translator in `dialect.ts` rewrites `INSERT OR REPLACE` into a
// bare `INSERT` with NO conflict clause, so re-importing any existing primary key
// violates the PK constraint and aborts the batch (the helpers' idempotency is
// SQLite-only). Here we emit an explicit `INSERT ... ON CONFLICT (<pk>) DO UPDATE
// SET ...`, which is a native upsert on SQLite AND passes through the Postgres
// translator unchanged — so re-runs merge by primary key (no duplicate rows) on
// both engines.

interface IngestSpec {
  table: string
  pk: string[]
  columns: string[]
  map: (row: Record<string, unknown>, now: string) => unknown[]
}

const numOr = (v: unknown, d = 0): number => {
  if (v == null) return d
  const num = Number(v)
  return Number.isFinite(num) ? num : d
}
const strOr = (v: unknown, d = ''): string => (v == null ? d : String(v))

function ingestSpecs(): IngestSpec[] {
  return [
    {
      table: 'requests',
      pk: ['id'],
      columns: [
        'id', 'agent', 'session_id', 'model', 'input_tokens', 'output_tokens',
        'cache_read_tokens', 'cache_create_tokens', 'cache_create_5m_tokens',
        'cache_create_1h_tokens', 'cost_usd', 'cost_basis', 'duration_ms', 'timestamp',
        'source_request_id', 'machine_id', 'cost_center_id', 'attribution_tag', 'account_key', 'account_tool',
        'account_name', 'account_email', 'account_source', 'updated_at', 'synced_at',
      ],
      map: (r, now) => [
        strOr(r['id']), strOr(r['agent']), strOr(r['session_id']), strOr(r['model']),
        numOr(r['input_tokens']), numOr(r['output_tokens']), numOr(r['cache_read_tokens']), numOr(r['cache_create_tokens']),
        numOr(r['cache_create_5m_tokens'] ?? r['cache_create_tokens']), numOr(r['cache_create_1h_tokens']),
        numOr(r['cost_usd']), strOr(r['cost_basis'], 'estimated'), numOr(r['duration_ms']), strOr(r['timestamp']),
        r['source_request_id'] == null ? null : strOr(r['source_request_id']), strOr(r['machine_id']),
        r['cost_center_id'] == null ? null : strOr(r['cost_center_id']),
        strOr(r['attribution_tag']), strOr(r['account_key']), strOr(r['account_tool']),
        strOr(r['account_name']), strOr(r['account_email']), strOr(r['account_source']),
        strOr(r['updated_at'], now), strOr(r['synced_at']),
      ],
    },
    {
      table: 'sessions',
      pk: ['id'],
      columns: [
        'id', 'agent', 'project_path', 'project_name', 'started_at', 'ended_at',
        'total_cost_usd', 'total_tokens', 'request_count', 'machine_id', 'cost_center_id', 'attribution_tag',
        'account_key', 'account_tool', 'account_name', 'account_email', 'account_source',
        'updated_at', 'synced_at',
      ],
      map: (r, now) => [
        strOr(r['id']), strOr(r['agent']), strOr(r['project_path']), strOr(r['project_name']),
        strOr(r['started_at']), r['ended_at'] == null ? null : strOr(r['ended_at']),
        numOr(r['total_cost_usd']), numOr(r['total_tokens']), numOr(r['request_count']), strOr(r['machine_id']),
        r['cost_center_id'] == null ? null : strOr(r['cost_center_id']),
        strOr(r['attribution_tag']), strOr(r['account_key']), strOr(r['account_tool']),
        strOr(r['account_name']), strOr(r['account_email']), strOr(r['account_source']),
        strOr(r['updated_at'], now), strOr(r['synced_at']),
      ],
    },
    {
      table: 'projects',
      pk: ['id'],
      columns: ['id', 'path', 'name', 'description', 'tags', 'created_at'],
      map: (r) => [
        strOr(r['id']), strOr(r['path']), strOr(r['name']),
        r['description'] == null ? null : strOr(r['description']),
        typeof r['tags'] === 'string' ? r['tags'] : JSON.stringify(r['tags'] ?? []),
        strOr(r['created_at']),
      ],
    },
    {
      table: 'budgets',
      pk: ['id'],
      columns: ['id', 'project_path', 'agent', 'period', 'limit_usd', 'alert_at_percent', 'created_at', 'updated_at'],
      map: (r) => [
        strOr(r['id']), r['project_path'] == null ? null : strOr(r['project_path']),
        r['agent'] == null ? null : strOr(r['agent']), strOr(r['period']),
        numOr(r['limit_usd']), numOr(r['alert_at_percent']), strOr(r['created_at']), strOr(r['updated_at']),
      ],
    },
    {
      table: 'goals',
      pk: ['id'],
      columns: ['id', 'period', 'project_path', 'agent', 'limit_usd', 'created_at', 'updated_at'],
      map: (r) => [
        strOr(r['id']), strOr(r['period']), r['project_path'] == null ? null : strOr(r['project_path']),
        r['agent'] == null ? null : strOr(r['agent']), numOr(r['limit_usd']), strOr(r['created_at']), strOr(r['updated_at']),
      ],
    },
    {
      table: 'billing_daily',
      pk: ['date', 'provider', 'description'],
      columns: ['date', 'provider', 'description', 'cost_usd', 'updated_at'],
      map: (r) => [strOr(r['date']), strOr(r['provider']), strOr(r['description']), numOr(r['cost_usd']), strOr(r['updated_at'])],
    },
    {
      table: 'model_pricing',
      pk: ['model'],
      columns: [
        'model', 'input_per_1m', 'output_per_1m', 'cache_read_per_1m', 'cache_write_per_1m',
        'cache_write_1h_per_1m', 'cache_storage_per_1m_hour', 'updated_at',
      ],
      map: (r) => [
        strOr(r['model']), numOr(r['input_per_1m']), numOr(r['output_per_1m']), numOr(r['cache_read_per_1m']),
        numOr(r['cache_write_per_1m']), numOr(r['cache_write_1h_per_1m']), numOr(r['cache_storage_per_1m_hour']), strOr(r['updated_at']),
      ],
    },
    {
      table: 'subscriptions',
      pk: ['id'],
      columns: [
        'id', 'agent', 'provider', 'plan', 'monthly_fee_usd', 'included_usage_usd',
        'billing_cycle_start', 'reset_policy', 'active', 'created_at', 'updated_at',
      ],
      map: (r) => [
        strOr(r['id']), r['agent'] == null ? null : strOr(r['agent']), strOr(r['provider']), strOr(r['plan']),
        numOr(r['monthly_fee_usd']), numOr(r['included_usage_usd']),
        r['billing_cycle_start'] == null ? null : strOr(r['billing_cycle_start']),
        strOr(r['reset_policy'], 'monthly'), numOr(r['active'], 1), strOr(r['created_at']), strOr(r['updated_at']),
      ],
    },
    {
      table: 'usage_snapshots',
      pk: ['id'],
      columns: ['id', 'agent', 'date', 'metric', 'value', 'unit', 'machine_id', 'updated_at'],
      map: (r, now) => [
        strOr(r['id'], `${strOr(r['agent'])}-${strOr(r['date'])}-${strOr(r['metric'])}-${strOr(r['machine_id'])}`),
        strOr(r['agent']), strOr(r['date']), strOr(r['metric']), numOr(r['value']), strOr(r['unit']), strOr(r['machine_id']), strOr(r['updated_at'], now),
      ],
    },
  ]
}

export function bulkIngest(db: Database, body: Record<string, unknown>): { ingested: Record<string, number>; total: number } {
  const now = new Date().toISOString()
  const ingested: Record<string, number> = {}
  for (const spec of ingestSpecs()) {
    const raw = body[spec.table]
    if (!Array.isArray(raw) || raw.length === 0) continue
    const cols = spec.columns
    const pkIdx = spec.pk.map(k => cols.indexOf(k))
    // De-dup by primary key within this payload (last write wins): Postgres
    // rejects a statement that updates the same ON CONFLICT row twice, so this
    // keeps the chunked multi-row upserts below safe.
    const deduped = new Map<string, unknown[]>()
    for (const row of raw as Record<string, unknown>[]) {
      const values = spec.map(row, now)
      const key = pkIdx.map(i => String(values[i])).join('\u0000')
      deduped.set(key, values)
    }
    const rows = [...deduped.values()]
    const updateCols = cols.filter(c => !spec.pk.includes(c))
    const conflictAction = updateCols.length
      ? `DO UPDATE SET ${updateCols.map(c => `"${c}" = excluded."${c}"`).join(', ')}`
      : 'DO NOTHING'
    const colList = cols.map(c => `"${c}"`).join(', ')
    const conflict = spec.pk.map(c => `"${c}"`).join(', ')
    // Keep bound-parameter counts within SQLite and Postgres limits on both engines.
    const chunkRows = Math.max(1, Math.floor(20000 / cols.length))
    const rowPlaceholder = `(${cols.map(() => '?').join(', ')})`
    for (let i = 0; i < rows.length; i += chunkRows) {
      const chunk = rows.slice(i, i + chunkRows)
      const valuesSql = chunk.map(() => rowPlaceholder).join(', ')
      const sql = `INSERT INTO ${spec.table} (${colList}) VALUES ${valuesSql} ON CONFLICT (${conflict}) ${conflictAction}`
      const params: unknown[] = []
      for (const values of chunk) params.push(...values)
      db.prepare(sql).run(...params)
    }
    ingested[spec.table] = rows.length
  }
  const total = Object.values(ingested).reduce((a, b) => a + b, 0)
  return { ingested, total }
}
