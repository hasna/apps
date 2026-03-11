import { describe, it, expect, beforeEach } from 'bun:test'
import {
  openDatabase, upsertRequest, upsertSession, rollupSession,
  querySummary, querySessions, queryTopSessions,
  queryModelBreakdown, queryProjectBreakdown, queryDailyBreakdown,
  queryRequestsSince, getIngestState, setIngestState,
  upsertProject, getProject, listProjects, deleteProject,
  upsertBudget, listBudgets, deleteBudget, getBudgetStatuses,
  upsertModelPricing, getModelPricing, listModelPricing, deleteModelPricing,
  seedModelPricing,
} from './database.js'
import type { EconomyRequest, EconomySession } from '../types/index.js'

function makeDb() {
  return openDatabase(':memory:', true)
}

const NOW = new Date().toISOString()
const TODAY = NOW.substring(0, 10)

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
})

describe('upsertRequest', () => {
  it('inserts a request', () => {
    const db = makeDb()
    upsertRequest(db, sampleRequest())
    const row = db.prepare('SELECT * FROM requests WHERE id = ?').get('req-1') as EconomyRequest
    expect(row.id).toBe('req-1')
    expect(row.cost_usd).toBe(0.05)
    expect(row.model).toBe('claude-sonnet-4-6')
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
    upsertSession(db, sampleSession())
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get('sess-1') as EconomySession
    expect(row.agent).toBe('claude')
    expect(row.project_name).toBe('myproject')
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
})

describe('model_pricing', () => {
  it('upserts and retrieves pricing', () => {
    const db = makeDb()
    upsertModelPricing(db, { model: 'test-model', input_per_1m: 3, output_per_1m: 15, cache_read_per_1m: 0.3, cache_write_per_1m: 3.75, updated_at: NOW })
    const p = getModelPricing(db, 'test-model')
    expect(p?.input_per_1m).toBe(3)
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
