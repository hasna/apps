import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Database as BunDatabase } from 'bun:sqlite'
import {
  openDatabase, getDataDir, getDbPath, upsertRequest, upsertSession, rollupSession,
  querySummary, querySessions, queryTopSessions,
  queryModelBreakdown, queryAgentBreakdown, queryProjectBreakdown, queryAccountBreakdown, queryDailyBreakdown, queryHourlyBreakdown,
  queryRequestsSince, getIngestState, setIngestState,
  upsertProject, getProject, listProjects, deleteProject,
  upsertBudget, listBudgets, deleteBudget, getBudgetStatuses,
  upsertGoal, getGoalStatuses,
  upsertModelPricing, getModelPricing, listModelPricing, deleteModelPricing,
  seedModelPricing, listMachines, getMachineId,
  upsertUsageSnapshot, queryUsageSnapshots,
  dedupeRequests,
} from './database.js'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { EconomyRequest, EconomySession } from '../types/index.js'

function makeDb() {
  return openDatabase(':memory:', true)
}

const NOW = new Date().toISOString()
const TODAY = NOW.substring(0, 10)
const tempRoots: string[] = []

function tempRoot(prefix: string): string {
  const root = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  tempRoots.push(root)
  return root
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})

function sampleRequest(overrides: Partial<EconomyRequest> = {}): EconomyRequest {
  return {
    id: 'req-1',
    agent: 'claude',
    session_id: 'sess-1',
    model: 'claude-sonnet-4-6',
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_tokens: 200,
    cache_create_tokens: 100,
    cost_usd: 0.05,
    duration_ms: 1500,
    timestamp: NOW,
    source_request_id: 'src-req-1',
    machine_id: '',
    ...overrides,
  }
}

function sampleSession(overrides: Partial<EconomySession> = {}): EconomySession {
  return {
    id: 'sess-1',
    agent: 'claude',
    project_path: '/home/user/myproject',
    project_name: 'myproject',
    started_at: NOW,
    ended_at: null,
    total_cost_usd: 0.05,
    total_tokens: 1800,
    request_count: 1,
    machine_id: '',
    ...overrides,
  }
}

describe('openDatabase', () => {
  it('creates all tables on first open', () => {
    const db = makeDb()
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
    const names = tables.map(t => t.name)
    expect(names).toContain('requests')
    expect(names).toContain('sessions')
    expect(names).toContain('budgets')
    expect(names).toContain('projects')
    expect(names).toContain('ingest_state')
    expect(names).toContain('model_pricing')
  })

  it('migrates legacy ~/.economy files into ~/.hasna/economy', () => {
    const originalHome = process.env['HOME']
    const originalUserProfile = process.env['USERPROFILE']
    const root = tempRoot('economy-data-dir-test')
    const legacyDir = join(root, '.economy')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'economy.db'), 'legacy')

    try {
      process.env['HOME'] = root
      delete process.env['USERPROFILE']

      const dataDir = getDataDir()

      expect(dataDir).toBe(join(root, '.hasna', 'economy'))
      expect(readFileSync(join(dataDir, 'economy.db'), 'utf-8')).toBe('legacy')
    } finally {
      restoreEnv('HOME', originalHome)
      restoreEnv('USERPROFILE', originalUserProfile)
    }
  })

  it('resolves database path env vars before the default data dir', () => {
    const originalHome = process.env['HOME']
    const originalUserProfile = process.env['USERPROFILE']
    const originalHasnaDb = process.env['HASNA_ECONOMY_DB_PATH']
    const originalEconomyDb = process.env['ECONOMY_DB']
    const root = tempRoot('economy-db-path-test')

    try {
      process.env['HOME'] = root
      delete process.env['USERPROFILE']
      process.env['HASNA_ECONOMY_DB_PATH'] = '/tmp/hasna-economy.db'
      process.env['ECONOMY_DB'] = '/tmp/economy.db'
      expect(getDbPath()).toBe('/tmp/hasna-economy.db')

      delete process.env['HASNA_ECONOMY_DB_PATH']
      expect(getDbPath()).toBe('/tmp/economy.db')

      delete process.env['ECONOMY_DB']
      expect(getDbPath()).toBe(join(root, '.hasna', 'economy', 'economy.db'))
    } finally {
      restoreEnv('HOME', originalHome)
      restoreEnv('USERPROFILE', originalUserProfile)
      restoreEnv('HASNA_ECONOMY_DB_PATH', originalHasnaDb)
      restoreEnv('ECONOMY_DB', originalEconomyDb)
    }
  })

  it('creates parent directories for file-backed databases', () => {
    const root = tempRoot('economy-file-db-test')
    const dbPath = join(root, 'nested', 'data', 'economy.db')

    openDatabase(dbPath, true)

    expect(existsSync(dirname(dbPath))).toBe(true)
    expect(existsSync(dbPath)).toBe(true)
  })

  it('migrates legacy request, session, and pricing schemas in place', () => {
    const root = tempRoot('economy-legacy-schema-test')
    const dbPath = join(root, 'economy.db')
    mkdirSync(root, { recursive: true })
    const legacyDb = new BunDatabase(dbPath)
    legacyDb.exec(`
      CREATE TABLE requests (
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

      CREATE TABLE sessions (
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

      CREATE TABLE model_pricing (
        model TEXT PRIMARY KEY,
        input_per_1m REAL NOT NULL DEFAULT 0,
        output_per_1m REAL NOT NULL DEFAULT 0,
        cache_read_per_1m REAL NOT NULL DEFAULT 0,
        cache_write_per_1m REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `)
    legacyDb.prepare(`
      INSERT INTO requests
        (id, agent, session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, cost_usd, duration_ms, timestamp, source_request_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('legacy-req', 'claude', 'legacy-session', 'claude-sonnet-4-6', 10, 20, 30, 77, 0.01, 123, NOW, 'source-1')
    legacyDb.prepare(`
      INSERT INTO sessions
        (id, agent, project_path, project_name, started_at, ended_at, total_cost_usd, total_tokens, request_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('legacy-session', 'claude', '/legacy/project', 'legacy-project', NOW, null, 0.01, 137, 1)
    legacyDb.prepare(`
      INSERT INTO model_pricing
        (model, input_per_1m, output_per_1m, cache_read_per_1m, cache_write_per_1m, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('legacy-model', 1, 2, 0.1, 3, NOW)
    legacyDb.close()

    const db = openDatabase(dbPath, true)
    const requestCols = (db.prepare(`PRAGMA table_info(requests)`).all() as Array<{ name: string }>).map(c => c.name)
    const sessionCols = (db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>).map(c => c.name)
    const pricingCols = (db.prepare(`PRAGMA table_info(model_pricing)`).all() as Array<{ name: string }>).map(c => c.name)

    expect(requestCols).toContain('machine_id')
    expect(requestCols).toContain('cache_create_5m_tokens')
    expect(requestCols).toContain('cache_create_1h_tokens')
    expect(requestCols).toContain('account_key')
    expect(sessionCols).toContain('machine_id')
    expect(sessionCols).toContain('account_key')
    expect(pricingCols).toContain('cache_write_1h_per_1m')
    expect(pricingCols).toContain('cache_storage_per_1m_hour')

    const migratedRequest = db.prepare(`
      SELECT cache_create_tokens, cache_create_5m_tokens, cache_create_1h_tokens, machine_id
      FROM requests WHERE id = ?
    `).get('legacy-req') as Record<string, string | number>
    expect(migratedRequest['cache_create_5m_tokens']).toBe(77)
    expect(migratedRequest['cache_create_1h_tokens']).toBe(0)
    expect(migratedRequest['machine_id']).toBe('')

    const migratedPricing = getModelPricing(db, 'legacy-model')
    expect(migratedPricing?.cache_write_1h_per_1m).toBe(0)
    expect(migratedPricing?.cache_storage_per_1m_hour).toBe(0)
  })
})

describe('upsertRequest', () => {
  it('inserts a request', () => {
    const db = makeDb()
    upsertRequest(db, sampleRequest({
      account_key: 'claude:work',
      account_tool: 'claude',
      account_name: 'work',
      account_email: 'work@example.com',
      account_source: 'current',
    }))
    const row = db.prepare('SELECT * FROM requests WHERE id = ?').get('req-1') as EconomyRequest
    expect(row.id).toBe('req-1')
    expect(row.cost_usd).toBe(0.05)
    expect(row.model).toBe('claude-sonnet-4-6')
    expect(row.account_key).toBe('claude:work')
    expect(row.account_email).toBe('work@example.com')
  })

  it('replaces on duplicate id', () => {
    const db = makeDb()
    upsertRequest(db, sampleRequest())
    upsertRequest(db, sampleRequest({ cost_usd: 0.99 }))
    const row = db.prepare('SELECT COUNT(*) as cnt FROM requests').get() as { cnt: number }
    expect(row.cnt).toBe(1)
    const r = db.prepare('SELECT cost_usd FROM requests WHERE id = ?').get('req-1') as { cost_usd: number }
    expect(r.cost_usd).toBe(0.99)
  })
})

describe('upsertSession + rollupSession', () => {
  it('inserts a session', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({
      account_key: 'codex:personal',
      account_tool: 'codex',
      account_name: 'personal',
      account_source: 'env',
    }))
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get('sess-1') as EconomySession
    expect(row.agent).toBe('claude')
    expect(row.project_name).toBe('myproject')
    expect(row.account_key).toBe('codex:personal')
  })

  it('rollupSession aggregates from requests', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({ total_cost_usd: 0, total_tokens: 0, request_count: 0 }))
    upsertRequest(db, sampleRequest({ id: 'r1', cost_usd: 0.10, input_tokens: 500, output_tokens: 250 }))
    upsertRequest(db, sampleRequest({ id: 'r2', cost_usd: 0.20, input_tokens: 1000, output_tokens: 500 }))
    rollupSession(db, 'sess-1')
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get('sess-1') as EconomySession
    expect(row.total_cost_usd).toBeCloseTo(0.30)
    expect(row.request_count).toBe(2)
  })
})

describe('querySummary', () => {
  it('returns zeros when no data', () => {
    const db = makeDb()
    const s = querySummary(db, 'today')
    expect(s.total_usd).toBe(0)
    expect(s.requests).toBe(0)
    expect(s.sessions).toBe(0)
    expect(s.tokens).toBe(0)
  })

  it('counts requests for today period', () => {
    const db = makeDb()
    upsertRequest(db, sampleRequest())
    upsertSession(db, sampleSession())
    const s = querySummary(db, 'today')
    expect(s.total_usd).toBeCloseTo(0.05)
    expect(s.requests).toBe(1)
  })

  it('supports all periods', () => {
    const db = makeDb()
    upsertRequest(db, sampleRequest())
    for (const p of ['today', 'week', 'month', 'all'] as const) {
      const s = querySummary(db, p)
      expect(typeof s.total_usd).toBe('number')
    }
  })

  it('counts request-backed sessions by request period rather than session start', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({
      id: 'old-active-spark',
      started_at: '2000-01-01T00:00:00.000Z',
      machine_id: 'spark02',
      total_cost_usd: 99,
      request_count: 99,
    }))
    upsertSession(db, sampleSession({
      id: 'old-active-apple',
      started_at: '2000-01-01T00:00:00.000Z',
      machine_id: 'apple06',
      total_cost_usd: 99,
      request_count: 99,
    }))
    upsertRequest(db, sampleRequest({
      id: 'today-spark-1',
      session_id: 'old-active-spark',
      timestamp: NOW,
      machine_id: 'spark02',
      cost_usd: 1,
    }))
    upsertRequest(db, sampleRequest({
      id: 'today-spark-2',
      session_id: 'old-active-spark',
      timestamp: NOW,
      machine_id: 'spark02',
      cost_usd: 2,
    }))
    upsertRequest(db, sampleRequest({
      id: 'today-apple',
      session_id: 'old-active-apple',
      timestamp: NOW,
      machine_id: 'apple06',
      cost_usd: 3,
    }))

    expect(querySummary(db, 'today', undefined, true).sessions).toBe(2)
    expect(querySummary(db, 'today', 'spark02').sessions).toBe(1)
    expect(querySummary(db, 'today', 'apple06').sessions).toBe(1)
  })
})

describe('querySessions', () => {
  it('returns sessions filtered by agent', () => {
    const db = makeDb()
    upsertSession(db, sampleSession())
    upsertSession(db, sampleSession({ id: 'sess-2', agent: 'codex' }))
    const results = querySessions(db, { agent: 'claude' })
    expect(results.length).toBe(1)
    expect(results[0]!.agent).toBe('claude')
  })

  it('respects limit and offset', () => {
    const db = makeDb()
    for (let i = 0; i < 5; i++) upsertSession(db, sampleSession({ id: `s-${i}` }))
    expect(querySessions(db, { limit: 2 }).length).toBe(2)
    expect(querySessions(db, { limit: 2, offset: 4 }).length).toBe(1)
  })

  it('filters by account key, name, or email', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({ id: 'work', account_key: 'claude:work', account_name: 'work', account_email: 'work@example.com' }))
    upsertSession(db, sampleSession({ id: 'home', account_key: 'claude:home', account_name: 'home', account_email: 'home@example.com' }))

    expect(querySessions(db, { account: 'work' }).map(s => s.id)).toEqual(['work'])
    expect(querySessions(db, { account: 'home@example.com' }).map(s => s.id)).toEqual(['home'])
  })
})

describe('queryTopSessions', () => {
  it('returns sessions sorted by cost desc', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({ id: 's1', total_cost_usd: 1.00 }))
    upsertSession(db, sampleSession({ id: 's2', total_cost_usd: 5.00 }))
    upsertSession(db, sampleSession({ id: 's3', total_cost_usd: 0.50 }))
    const top = queryTopSessions(db, 2)
    expect(top[0]!.id).toBe('s2')
    expect(top[1]!.id).toBe('s1')
  })

  it('filters top sessions by agent before applying the limit', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({ id: 'claude-expensive', agent: 'claude', total_cost_usd: 50.00 }))
    upsertSession(db, sampleSession({ id: 'codex-expensive', agent: 'codex', total_cost_usd: 5.00 }))
    upsertSession(db, sampleSession({ id: 'codex-cheap', agent: 'codex', total_cost_usd: 1.00 }))

    const top = queryTopSessions(db, 1, 'codex')

    expect(top).toHaveLength(1)
    expect(top[0]!.id).toBe('codex-expensive')
  })
})

describe('queryModelBreakdown', () => {
  it('groups by model and agent', () => {
    const db = makeDb()
    upsertRequest(db, sampleRequest({ id: 'r1', model: 'claude-sonnet-4-6', cost_usd: 0.10 }))
    upsertRequest(db, sampleRequest({ id: 'r2', model: 'claude-sonnet-4-6', cost_usd: 0.20 }))
    upsertRequest(db, sampleRequest({ id: 'r3', model: 'claude-opus-4-6', cost_usd: 1.00 }))
    const breakdown = queryModelBreakdown(db)
    expect(breakdown.length).toBe(2)
    const opus = breakdown.find(b => b.model === 'claude-opus-4-6')
    expect(opus?.cost_usd).toBeCloseTo(1.00)
    const sonnet = breakdown.find(b => b.model === 'claude-sonnet-4-6')
    expect(sonnet?.requests).toBe(2)
  })
})

describe('queryAgentBreakdown', () => {
  it('splits usage by agent and falls back to session totals without request rows', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({
      id: 'claude-session',
      agent: 'claude',
      total_cost_usd: 99,
      total_tokens: 99,
      request_count: 9,
    }))
    upsertSession(db, sampleSession({
      id: 'cursor-session',
      agent: 'cursor',
      total_cost_usd: 50,
      total_tokens: 50,
      request_count: 5,
    }))
    upsertSession(db, sampleSession({
      id: 'codex-legacy-session',
      agent: 'codex',
      total_cost_usd: 4,
      total_tokens: 400,
      request_count: 1,
    }))
    upsertRequest(db, sampleRequest({
      id: 'claude-request',
      session_id: 'claude-session',
      agent: 'claude',
      cost_usd: 1,
      cost_basis: 'metered_api',
    }))
    upsertRequest(db, sampleRequest({
      id: 'cursor-request',
      session_id: 'cursor-session',
      agent: 'cursor',
      cost_usd: 2,
      cost_basis: 'subscription_included',
    }))

    const breakdown = queryAgentBreakdown(db, 'all')
    const claude = breakdown.find(row => row.agent === 'claude')
    const cursor = breakdown.find(row => row.agent === 'cursor')
    const codex = breakdown.find(row => row.agent === 'codex')

    expect(claude?.sessions).toBe(1)
    expect(claude?.requests).toBe(1)
    expect(claude?.api_equivalent_usd).toBe(1)
    expect(claude?.billable_usd).toBe(1)
    expect(claude?.metered_api_usd).toBe(1)
    expect(cursor?.api_equivalent_usd).toBe(2)
    expect(cursor?.billable_usd).toBe(0)
    expect(cursor?.subscription_included_usd).toBe(2)
    expect(codex?.sessions).toBe(1)
    expect(codex?.requests).toBe(1)
    expect(codex?.total_tokens).toBe(400)
    expect(codex?.api_equivalent_usd).toBe(4)
    expect(codex?.estimated_usd).toBe(4)
  })
})

describe('queryProjectBreakdown', () => {
  it('groups sessions by project_path', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({ id: 's1', project_path: '/a', project_name: 'a', total_cost_usd: 1.0 }))
    upsertSession(db, sampleSession({ id: 's2', project_path: '/a', project_name: 'a', total_cost_usd: 2.0 }))
    upsertSession(db, sampleSession({ id: 's3', project_path: '/b', project_name: 'b', total_cost_usd: 5.0 }))
    const breakdown = queryProjectBreakdown(db)
    expect(breakdown[0]!.project_path).toBe('/b')
    expect(breakdown[0]!.sessions).toBe(1)
  })

  it('filters projects by period', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({
      id: 'recent',
      project_path: '/recent',
      project_name: 'recent',
      total_cost_usd: 1.0,
      started_at: NOW,
    }))
    upsertSession(db, sampleSession({
      id: 'old',
      project_path: '/old',
      project_name: 'old',
      total_cost_usd: 100.0,
      started_at: '2000-01-01T00:00:00.000Z',
    }))

    expect(queryProjectBreakdown(db, 'month').map(row => row.project_name)).toEqual(['recent'])
    expect(queryProjectBreakdown(db, 'all').map(row => row.project_name)).toContain('old')
  })

  it('uses request timestamps for request-backed project periods', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({
      id: 'old-session-current-request',
      project_path: '/cross',
      project_name: 'cross',
      total_cost_usd: 100,
      started_at: '2000-01-01T00:00:00.000Z',
    }))
    upsertSession(db, sampleSession({
      id: 'current-session-old-request',
      project_path: '/stale',
      project_name: 'stale',
      total_cost_usd: 100,
      started_at: NOW,
    }))
    upsertRequest(db, sampleRequest({
      id: 'current-request',
      session_id: 'old-session-current-request',
      cost_usd: 7,
      timestamp: NOW,
    }))
    upsertRequest(db, sampleRequest({
      id: 'old-request',
      session_id: 'current-session-old-request',
      cost_usd: 99,
      timestamp: '2000-01-01T00:00:00.000Z',
    }))

    const month = queryProjectBreakdown(db, 'month')

    expect(month.find(row => row.project_name === 'cross')?.cost_usd).toBe(7)
    expect(month.find(row => row.project_name === 'cross')?.sessions).toBe(1)
    expect(month.some(row => row.project_name === 'stale')).toBe(false)
  })

  it('derives stable project labels from nested paths when project_name is empty', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({
      id: 'prefixed',
      project_path: '/home/hasna/workspace/hasna/opensource/open-economy/packages/web',
      project_name: '',
      total_cost_usd: 2.00,
    }))
    upsertSession(db, sampleSession({
      id: 'fallback',
      project_path: '/home/hasna/workspace/custom-client/packages/web',
      project_name: '',
      total_cost_usd: 1.00,
    }))

    const names = queryProjectBreakdown(db).map(row => row.project_name)

    expect(names).toContain('open-economy')
    expect(names).toContain('custom-client')
  })

  it('groups the same repo across machine-specific home directories', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({
      id: 'spark-open-economy',
      project_path: '/home/hasna/workspace/hasna/opensource/open-economy',
      project_name: 'Economy on Spark',
      machine_id: 'spark02',
      total_cost_usd: 2.00,
    }))
    upsertSession(db, sampleSession({
      id: 'apple-open-economy',
      project_path: '/Users/hasna/Workspace/hasna/opensource/open-economy',
      project_name: 'Economy on Apple',
      machine_id: 'apple06',
      total_cost_usd: 3.00,
    }))

    const row = queryProjectBreakdown(db).find(project => project.project_name === 'open-economy')

    expect(row?.sessions).toBe(2)
    expect(row?.cost_usd).toBeCloseTo(5)
  })
})

describe('queryAccountBreakdown', () => {
  it('groups spend by account profile and uses request totals when present', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({
      id: 's1',
      account_key: 'claude:work',
      account_tool: 'claude',
      account_name: 'work',
      account_email: 'work@example.com',
      account_source: 'current',
      total_cost_usd: 99,
      total_tokens: 99,
      request_count: 9,
    }))
    upsertSession(db, sampleSession({
      id: 's2',
      agent: 'codex',
      account_key: 'codex:personal',
      account_tool: 'codex',
      account_name: 'personal',
      account_source: 'env',
      total_cost_usd: 5,
    }))
    upsertRequest(db, sampleRequest({
      id: 'r1',
      session_id: 's1',
      account_key: 'claude:work',
      account_tool: 'claude',
      account_name: 'work',
      cost_usd: 1,
      cost_basis: 'metered_api',
    }))
    upsertRequest(db, sampleRequest({
      id: 'r2',
      session_id: 's1',
      account_key: 'claude:work',
      account_tool: 'claude',
      account_name: 'work',
      cost_usd: 2,
      cost_basis: 'subscription_included',
    }))

    const breakdown = queryAccountBreakdown(db, 'all')
    const work = breakdown.find(row => row.account_key === 'claude:work@example.com')
    const personal = breakdown.find(row => row.account_key === 'codex:personal')

    expect(work?.sessions).toBe(1)
    expect(work?.requests).toBe(2)
    expect(work?.cost_usd).toBe(3)
    expect(work?.api_equivalent_usd).toBe(3)
    expect(work?.billable_usd).toBe(1)
    expect(work?.metered_api_usd).toBe(1)
    expect(work?.subscription_included_usd).toBe(2)
    expect(work?.estimated_usd).toBe(0)
    expect(work?.unknown_usd).toBe(0)
    expect(work?.account_email).toBe('work@example.com')
    expect(personal?.cost_usd).toBe(5)
    expect(personal?.api_equivalent_usd).toBe(5)
    expect(personal?.billable_usd).toBe(0)
    expect(personal?.estimated_usd).toBe(5)
  })

  it('uses request timestamps for request-backed account periods', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({
      id: 'old-account-session-current-request',
      account_key: 'claude:work',
      account_tool: 'claude',
      account_name: 'work',
      account_email: 'work@example.com',
      account_source: 'current',
      total_cost_usd: 100,
      started_at: '2000-01-01T00:00:00.000Z',
    }))
    upsertSession(db, sampleSession({
      id: 'current-account-session-old-request',
      account_key: 'cursor:pro',
      account_tool: 'cursor',
      account_name: 'pro',
      account_source: 'current',
      total_cost_usd: 100,
      started_at: NOW,
    }))
    upsertRequest(db, sampleRequest({
      id: 'current-account-request',
      session_id: 'old-account-session-current-request',
      account_key: 'claude:work',
      account_tool: 'claude',
      account_name: 'work',
      cost_usd: 7,
      cost_basis: 'metered_api',
      timestamp: NOW,
    }))
    upsertRequest(db, sampleRequest({
      id: 'old-account-request',
      session_id: 'current-account-session-old-request',
      account_key: 'cursor:pro',
      account_tool: 'cursor',
      account_name: 'pro',
      cost_usd: 99,
      cost_basis: 'subscription_included',
      timestamp: '2000-01-01T00:00:00.000Z',
    }))

    const month = queryAccountBreakdown(db, 'month')

    expect(month.find(row => row.account_key === 'claude:work@example.com')?.api_equivalent_usd).toBe(7)
    expect(month.find(row => row.account_key === 'claude:work@example.com')?.sessions).toBe(1)
    expect(month.some(row => row.account_key === 'cursor:pro')).toBe(false)
  })

  it('splits the same email into separate accounts per coding agent', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({
      id: 'claude-shared-email',
      agent: 'claude',
      account_key: 'claude:legacy',
      account_tool: 'claude',
      account_name: 'work',
      account_email: 'shared@example.com',
    }))
    upsertSession(db, sampleSession({
      id: 'codex-shared-email',
      agent: 'codex',
      account_key: 'codex:legacy',
      account_tool: 'codex',
      account_name: 'work',
      account_email: 'shared@example.com',
    }))
    upsertRequest(db, sampleRequest({
      id: 'claude-shared-request',
      session_id: 'claude-shared-email',
      agent: 'claude',
      source_request_id: 'claude-shared-request',
      account_email: 'shared@example.com',
      cost_usd: 1,
    }))
    upsertRequest(db, sampleRequest({
      id: 'codex-shared-request',
      session_id: 'codex-shared-email',
      agent: 'codex',
      source_request_id: 'codex-shared-request',
      account_email: 'shared@example.com',
      cost_usd: 2,
    }))

    const breakdown = queryAccountBreakdown(db, 'all')

    expect(breakdown.map(row => row.account_key).sort()).toEqual(['claude:shared@example.com', 'codex:shared@example.com'])
    expect(breakdown.find(row => row.account_key === 'claude:shared@example.com')?.account_tool).toBe('claude')
    expect(breakdown.find(row => row.account_key === 'codex:shared@example.com')?.account_tool).toBe('codex')
  })
})

describe('queryDailyBreakdown', () => {
  it('returns array of date/agent/cost rows', () => {
    const db = makeDb()
    upsertRequest(db, sampleRequest())
    const daily = queryDailyBreakdown(db, 30)
    expect(Array.isArray(daily)).toBe(true)
    if (daily.length > 0) {
      expect(daily[0]).toHaveProperty('date')
      expect(daily[0]).toHaveProperty('cost_usd')
    }
  })

  it('queryDailyBreakdown filters rows by machine', () => {
    const db = makeDb()
    upsertRequest(db, sampleRequest({ id: 'daily-spark', source_request_id: 'daily-spark', cost_usd: 1, machine_id: 'spark01' }))
    upsertRequest(db, sampleRequest({ id: 'daily-apple', source_request_id: 'daily-apple', cost_usd: 2, machine_id: 'apple01' }))

    const spark = queryDailyBreakdown(db, 30, 'spark01')

    expect(spark.reduce((sum, row) => sum + row.cost_usd, 0)).toBeCloseTo(1)
    expect(spark.every(row => row.agent === 'claude')).toBe(true)
  })

  it('queryHourlyBreakdown returns today rows grouped by hour', () => {
    const db = makeDb()
    upsertRequest(db, sampleRequest({ id: 'hour-spark', source_request_id: 'hour-spark', cost_usd: 1, machine_id: 'spark01' }))
    upsertRequest(db, sampleRequest({ id: 'hour-apple', source_request_id: 'hour-apple', cost_usd: 2, machine_id: 'apple01' }))

    const all = queryHourlyBreakdown(db)
    const spark = queryHourlyBreakdown(db, 'spark01')

    expect(all.reduce((sum, row) => sum + row.cost_usd, 0)).toBeCloseTo(3)
    expect(spark.reduce((sum, row) => sum + row.cost_usd, 0)).toBeCloseTo(1)
    expect(spark[0]).toHaveProperty('hour')
  })

  it('queryHourlyBreakdown supports rolling hour windows', () => {
    const db = makeDb()
    const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString()
    upsertRequest(db, sampleRequest({ id: 'hour-current', source_request_id: 'hour-current', cost_usd: 1 }))
    upsertRequest(db, sampleRequest({
      id: 'hour-old',
      source_request_id: 'hour-old',
      cost_usd: 2,
      timestamp: thirteenHoursAgo,
    }))

    const rolling = queryHourlyBreakdown(db, undefined, 12)

    expect(rolling.reduce((sum, row) => sum + row.cost_usd, 0)).toBeCloseTo(1)
  })
})

describe('queryRequestsSince', () => {
  it('returns only requests after the given timestamp', () => {
    const db = makeDb()
    const past = new Date(Date.now() - 10000).toISOString()
    upsertRequest(db, sampleRequest({ id: 'old', timestamp: past }))
    upsertRequest(db, sampleRequest({ id: 'new', timestamp: NOW }))
    const since = new Date(Date.now() - 5000).toISOString()
    const results = queryRequestsSince(db, since)
    expect(results.some(r => r.id === 'new')).toBe(true)
    expect(results.some(r => r.id === 'old')).toBe(false)
  })
})

describe('queryUsageSnapshots', () => {
  it('filters usage snapshots by exact date and since date', () => {
    const db = makeDb()
    upsertUsageSnapshot(db, {
      agent: 'cursor',
      date: '2000-01-01',
      metric: 'included_consumed_usd',
      value: 1,
      unit: 'usd',
      machine_id: 'test-machine',
    })
    upsertUsageSnapshot(db, {
      agent: 'cursor',
      date: TODAY,
      metric: 'included_consumed_usd',
      value: 2,
      unit: 'usd',
      machine_id: 'test-machine',
    })

    expect(queryUsageSnapshots(db, { date: TODAY }).map(row => row.value)).toEqual([2])
    expect(queryUsageSnapshots(db, { since: TODAY }).map(row => row.value)).toEqual([2])
    expect(queryUsageSnapshots(db, { since: '1999-01-01' }).map(row => row.value).sort()).toEqual([1, 2])
  })
})

describe('ingest_state', () => {
  it('sets and gets values', () => {
    const db = makeDb()
    setIngestState(db, 'claude', 'file1.json', 'done')
    expect(getIngestState(db, 'claude', 'file1.json')).toBe('done')
    expect(getIngestState(db, 'claude', 'missing.json')).toBeNull()
  })

  it('overwrites existing values', () => {
    const db = makeDb()
    setIngestState(db, 'claude', 'k', 'v1')
    setIngestState(db, 'claude', 'k', 'v2')
    expect(getIngestState(db, 'claude', 'k')).toBe('v2')
  })
})

describe('projects', () => {
  const proj = { id: 'p1', path: '/my/proj', name: 'My Project', description: null, tags: [], created_at: NOW }

  it('upserts and retrieves a project', () => {
    const db = makeDb()
    upsertProject(db, proj)
    const p = getProject(db, '/my/proj')
    expect(p?.name).toBe('My Project')
  })

  it('lists projects', () => {
    const db = makeDb()
    upsertProject(db, proj)
    upsertProject(db, { ...proj, id: 'p2', path: '/other' })
    expect(listProjects(db).length).toBe(2)
  })

  it('deletes a project', () => {
    const db = makeDb()
    upsertProject(db, proj)
    deleteProject(db, '/my/proj')
    expect(getProject(db, '/my/proj')).toBeNull()
  })
})

describe('budgets', () => {
  const budget = {
    id: 'b1', project_path: null, agent: null,
    period: 'monthly' as const, limit_usd: 100,
    alert_at_percent: 80, created_at: NOW, updated_at: NOW,
  }

  it('upserts and lists budgets', () => {
    const db = makeDb()
    upsertBudget(db, budget)
    expect(listBudgets(db).length).toBe(1)
  })

  it('deletes a budget', () => {
    const db = makeDb()
    upsertBudget(db, budget)
    deleteBudget(db, 'b1')
    expect(listBudgets(db).length).toBe(0)
  })

  it('getBudgetStatuses returns spend and percent', () => {
    const db = makeDb()
    upsertBudget(db, budget)
    const statuses = getBudgetStatuses(db)
    expect(statuses[0]?.percent_used).toBeDefined()
    expect(typeof statuses[0]?.current_spend_usd).toBe('number')
  })

  it('getBudgetStatuses filters spend by project path and agent', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({ id: 'tracked-session', project_path: '/tracked' }))
    upsertSession(db, sampleSession({ id: 'other-session', project_path: '/other' }))
    upsertRequest(db, sampleRequest({ id: 'tracked-codex', session_id: 'tracked-session', agent: 'codex', cost_usd: 4 }))
    upsertRequest(db, sampleRequest({ id: 'tracked-claude', session_id: 'tracked-session', agent: 'claude', cost_usd: 8 }))
    upsertRequest(db, sampleRequest({ id: 'other-codex', session_id: 'other-session', agent: 'codex', cost_usd: 16 }))
    upsertBudget(db, { ...budget, id: 'filtered', project_path: '/tracked', agent: 'codex', limit_usd: 8 })

    const status = getBudgetStatuses(db).find(row => row.id === 'filtered')

    expect(status?.current_spend_usd).toBe(4)
    expect(status?.percent_used).toBe(50)
    expect(status?.is_over_alert).toBe(false)
  })
})

describe('goals', () => {
  it('getGoalStatuses filters spend by project path and agent', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({ id: 'tracked-session', project_path: '/tracked' }))
    upsertSession(db, sampleSession({ id: 'other-session', project_path: '/other' }))
    upsertRequest(db, sampleRequest({ id: 'tracked-gemini', session_id: 'tracked-session', agent: 'gemini', cost_usd: 3 }))
    upsertRequest(db, sampleRequest({ id: 'tracked-codex', session_id: 'tracked-session', agent: 'codex', cost_usd: 7 }))
    upsertRequest(db, sampleRequest({ id: 'other-gemini', session_id: 'other-session', agent: 'gemini', cost_usd: 11 }))
    upsertGoal(db, {
      id: 'goal-1',
      period: 'month',
      project_path: '/tracked',
      agent: 'gemini',
      limit_usd: 4,
      created_at: NOW,
      updated_at: NOW,
    })

    const status = getGoalStatuses(db)[0]

    expect(status?.current_spend_usd).toBe(3)
    expect(status?.percent_used).toBe(75)
    expect(status?.is_on_track).toBe(false)
    expect(status?.is_at_risk).toBe(true)
    expect(status?.is_over).toBe(false)
  })
})

describe('model_pricing', () => {
  it('upserts and retrieves pricing', () => {
    const db = makeDb()
    upsertModelPricing(db, { model: 'test-model', input_per_1m: 3, output_per_1m: 15, cache_read_per_1m: 0.3, cache_write_per_1m: 3.75, cache_storage_per_1m_hour: 4.5, updated_at: NOW })
    const p = getModelPricing(db, 'test-model')
    expect(p?.input_per_1m).toBe(3)
    expect(p?.cache_storage_per_1m_hour).toBe(4.5)
  })

  it('lists all pricing', () => {
    const db = makeDb()
    upsertModelPricing(db, { model: 'a', input_per_1m: 1, output_per_1m: 2, cache_read_per_1m: 0, cache_write_per_1m: 0, updated_at: NOW })
    upsertModelPricing(db, { model: 'b', input_per_1m: 3, output_per_1m: 6, cache_read_per_1m: 0, cache_write_per_1m: 0, updated_at: NOW })
    expect(listModelPricing(db).length).toBe(2)
  })

  it('deletes pricing', () => {
    const db = makeDb()
    upsertModelPricing(db, { model: 'x', input_per_1m: 1, output_per_1m: 2, cache_read_per_1m: 0, cache_write_per_1m: 0, updated_at: NOW })
    deleteModelPricing(db, 'x')
    expect(getModelPricing(db, 'x')).toBeNull()
  })

  it('seedModelPricing only seeds once', () => {
    const db = makeDb()
    const defaults = { 'model-a': { inputPer1M: 1, outputPer1M: 2, cacheReadPer1M: 0, cacheWritePer1M: 0 } }
    seedModelPricing(db, defaults)
    seedModelPricing(db, defaults)
    expect(listModelPricing(db).length).toBe(1)
  })
})

describe('machine_id support', () => {
  it('getMachineId returns a non-empty string', () => {
    expect(getMachineId().length).toBeGreaterThan(0)
  })

  it('respects ECONOMY_MACHINE_ID env var', () => {
    const orig = process.env['ECONOMY_MACHINE_ID']
    process.env['ECONOMY_MACHINE_ID'] = 'test-machine'
    expect(getMachineId()).toBe('test-machine')
    if (orig) process.env['ECONOMY_MACHINE_ID'] = orig
    else delete process.env['ECONOMY_MACHINE_ID']
  })

  it('stores and retrieves machine_id on requests', () => {
    const db = makeDb()
    upsertRequest(db, sampleRequest({ machine_id: 'spark01' }))
    const row = db.prepare('SELECT machine_id FROM requests WHERE id = ?').get('req-1') as { machine_id: string }
    expect(row.machine_id).toBe('spark01')
  })

  it('stores and retrieves machine_id on sessions', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({ machine_id: 'apple01' }))
    const row = db.prepare('SELECT machine_id FROM sessions WHERE id = ?').get('sess-1') as { machine_id: string }
    expect(row.machine_id).toBe('apple01')
  })

  it('querySessions filters by machine', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({ id: 's1', machine_id: 'spark01' }))
    upsertSession(db, sampleSession({ id: 's2', machine_id: 'apple01' }))
    upsertSession(db, sampleSession({ id: 's3', machine_id: 'spark01' }))
    const sparkSessions = querySessions(db, { machine: 'spark01' })
    expect(sparkSessions.length).toBe(2)
    expect(sparkSessions.every(s => (s as unknown as Record<string, unknown>)['machine_id'] === 'spark01')).toBe(true)
  })

  it('querySummary filters by machine', () => {
    const db = makeDb()
    upsertRequest(db, sampleRequest({ id: 'r1', session_id: 's1', cost_usd: 1.00, machine_id: 'spark01' }))
    upsertRequest(db, sampleRequest({ id: 'r2', session_id: 's2', cost_usd: 2.00, machine_id: 'apple01' }))
    upsertSession(db, sampleSession({ id: 's1', machine_id: 'spark01', total_cost_usd: 1.00 }))
    upsertSession(db, sampleSession({ id: 's2', machine_id: 'apple01', total_cost_usd: 2.00 }))
    const all = querySummary(db, 'all')
    expect(all.total_usd).toBeCloseTo(3.00)
    const sparkOnly = querySummary(db, 'all', 'spark01')
    expect(sparkOnly.total_usd).toBeCloseTo(1.00)
  })

  it('breakdowns filter by machine', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({
      id: 'spark-session',
      agent: 'claude',
      project_path: '/workspace/open-economy',
      project_name: 'open-economy',
      machine_id: 'spark01',
      total_cost_usd: 1,
      account_key: 'claude:spark',
      account_tool: 'claude',
      account_name: 'spark',
    }))
    upsertSession(db, sampleSession({
      id: 'apple-session',
      agent: 'codex',
      project_path: '/workspace/apple-project',
      project_name: 'apple-project',
      machine_id: 'apple01',
      total_cost_usd: 2,
      account_key: 'codex:apple',
      account_tool: 'codex',
      account_name: 'apple',
    }))
    upsertRequest(db, sampleRequest({
      id: 'spark-request',
      session_id: 'spark-session',
      agent: 'claude',
      cost_usd: 1,
      timestamp: NOW,
      source_request_id: 'spark-request',
      machine_id: 'spark01',
      account_key: 'claude:spark',
      account_tool: 'claude',
      account_name: 'spark',
    }))
    upsertRequest(db, sampleRequest({
      id: 'apple-request',
      session_id: 'apple-session',
      agent: 'codex',
      cost_usd: 2,
      timestamp: NOW,
      source_request_id: 'apple-request',
      machine_id: 'apple01',
      account_key: 'codex:apple',
      account_tool: 'codex',
      account_name: 'apple',
    }))

    expect(queryAgentBreakdown(db, 'all', 'spark01').map(row => row.agent)).toEqual(['claude'])
    expect(queryProjectBreakdown(db, 'all', 'spark01').map(row => row.project_name)).toEqual(['open-economy'])
    expect(queryAccountBreakdown(db, 'all', 'spark01').map(row => row.account_key)).toEqual(['claude:spark'])
    expect(queryDailyBreakdown(db, 14, 'spark01').reduce((sum, row) => sum + row.cost_usd, 0)).toBeCloseTo(1)
  })

  it('project and account breakdowns use request machine ids when session machine ids are missing', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({
      id: 'legacy-spark-session',
      project_path: '/home/hasna/open-economy',
      project_name: 'open-economy',
      machine_id: '',
      account_key: 'claude:spark',
      account_tool: 'claude',
      account_name: 'spark',
      account_source: 'test',
    }))
    upsertRequest(db, sampleRequest({
      id: 'legacy-spark-request',
      session_id: 'legacy-spark-session',
      source_request_id: 'legacy-spark-request',
      machine_id: 'spark01',
      cost_usd: 3,
      account_key: 'claude:spark',
      account_tool: 'claude',
      account_name: 'spark',
      account_source: 'test',
    }))

    const projects = queryProjectBreakdown(db, 'all', 'spark01')
    const accounts = queryAccountBreakdown(db, 'all', 'spark01')

    expect(projects.map(row => row.project_name)).toEqual(['open-economy'])
    expect(projects[0]?.cost_usd).toBeCloseTo(3)
    expect(accounts.map(row => row.account_key)).toEqual(['claude:spark'])
    expect(accounts[0]?.api_equivalent_usd).toBeCloseTo(3)
  })

  it('listMachines returns grouped machine data', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({ id: 's1', machine_id: 'spark01', total_cost_usd: 5.00 }))
    upsertSession(db, sampleSession({ id: 's2', machine_id: 'spark01', total_cost_usd: 3.00 }))
    upsertSession(db, sampleSession({ id: 's3', machine_id: 'apple01', total_cost_usd: 10.00 }))
    const machines = listMachines(db)
    expect(machines.length).toBe(2)
    const apple = machines.find(m => m.machine_id === 'apple01')
    expect(apple?.sessions).toBe(1)
    expect(apple?.total_cost_usd).toBeCloseTo(10.00)
    const spark = machines.find(m => m.machine_id === 'spark01')
    expect(spark?.sessions).toBe(2)
  })

  it('listMachines can return period-specific request-backed activity', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({
      id: 'old-spark-active-today',
      started_at: '2000-01-01T00:00:00.000Z',
      machine_id: 'spark01',
      total_cost_usd: 10,
    }))
    upsertSession(db, sampleSession({
      id: 'old-apple-active-today',
      started_at: '2000-01-01T00:00:00.000Z',
      machine_id: 'apple01',
      total_cost_usd: 10,
    }))
    upsertRequest(db, sampleRequest({
      id: 'spark-request-today',
      session_id: 'old-spark-active-today',
      timestamp: NOW,
      machine_id: 'spark01',
      cost_usd: 1,
    }))
    upsertRequest(db, sampleRequest({
      id: 'apple-request-old',
      session_id: 'old-apple-active-today',
      timestamp: '2000-01-01T00:00:00.000Z',
      machine_id: 'apple01',
      cost_usd: 2,
    }))

    const todayMachines = listMachines(db, 'today')

    expect(todayMachines.map(m => m.machine_id)).toEqual(['spark01'])
    expect(todayMachines[0]?.sessions).toBe(1)
    expect(todayMachines[0]?.requests).toBe(1)
  })

  it('listMachines excludes empty machine_id', () => {
    const db = makeDb()
    upsertSession(db, sampleSession({ id: 's1', machine_id: '' }))
    upsertSession(db, sampleSession({ id: 's2', machine_id: 'spark01' }))
    const machines = listMachines(db)
    expect(machines.length).toBe(1)
    expect(machines[0]!.machine_id).toBe('spark01')
  })

  it('dedupeRequests keeps matching source ids from different machines', () => {
    const db = makeDb()
    upsertRequest(db, sampleRequest({
      id: 'spark-req',
      session_id: 'spark-session',
      source_request_id: 'shared-source',
      machine_id: 'spark02',
      cost_usd: 1,
    }))
    upsertRequest(db, sampleRequest({
      id: 'apple-req',
      session_id: 'apple-session',
      source_request_id: 'shared-source',
      machine_id: 'apple06',
      cost_usd: 2,
    }))

    expect(dedupeRequests(db)).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) as cnt FROM requests`).get() as { cnt: number }).cnt).toBe(2)
  })

  it('dedupeRequests removes duplicate source ids from the same machine', () => {
    const db = makeDb()
    upsertRequest(db, sampleRequest({
      id: 'req-a',
      source_request_id: 'same-source',
      machine_id: 'spark02',
    }))
    upsertRequest(db, sampleRequest({
      id: 'req-b',
      source_request_id: 'same-source',
      machine_id: 'spark02',
    }))

    expect(dedupeRequests(db)).toBe(1)
    expect((db.prepare(`SELECT COUNT(*) as cnt FROM requests`).get() as { cnt: number }).cnt).toBe(1)
  })
})
