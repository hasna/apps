import { describe, it, expect, beforeEach } from 'bun:test'
import { openDatabase, upsertRequest, upsertSession, upsertBudget, upsertModelPricing, upsertBillingDaily } from '../db/database.js'
import { createHandler } from './serve.js'
import type { SqliteAdapter as Database } from '@hasna/cloud'

const NOW = new Date().toISOString()

function makeDb(): Database {
  return openDatabase(':memory:', true)
}

function seedData(db: Database) {
  upsertSession(db, {
    id: 'sess-1', agent: 'claude', project_path: '/proj/a', project_name: 'proj-a',
    started_at: NOW, ended_at: null, total_cost_usd: 1.5, total_tokens: 5000, request_count: 3,
  })
  upsertRequest(db, {
    id: 'req-1', agent: 'claude', session_id: 'sess-1', model: 'claude-sonnet-4-6',
    input_tokens: 1000, output_tokens: 500, cache_read_tokens: 0, cache_create_tokens: 0,
    cost_usd: 1.5, duration_ms: 2000, timestamp: NOW, source_request_id: 'src-1',
  })
  upsertBudget(db, {
    id: 'bud-1', project_path: null, agent: null, period: 'monthly',
    limit_usd: 100, alert_at_percent: 80, created_at: NOW, updated_at: NOW,
  })
  upsertModelPricing(db, {
    model: 'claude-sonnet-4-6', input_per_1m: 3, output_per_1m: 15,
    cache_read_per_1m: 0.3, cache_write_per_1m: 3.75, updated_at: NOW,
  })
}

async function req(handler: (r: Request) => Promise<Response>, path: string, method = 'GET', body?: unknown): Promise<{ status: number; data: unknown }> {
  const r = new Request(`http://localhost:3456${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const res = await handler(r)
  const json = await res.json() as unknown
  return { status: res.status, data: json }
}

describe('REST API server', () => {
  let handler: (r: Request) => Promise<Response>
  let db: Database

  beforeEach(() => {
    db = makeDb()
    seedData(db)
    handler = createHandler(db)
  })

  it('GET /health returns ok', async () => {
    const { status, data } = await req(handler, '/health')
    expect(status).toBe(200)
    expect((data as Record<string, unknown>)['data']).toMatchObject({ status: 'ok' })
  })

  it('GET /api/summary returns cost summary', async () => {
    const { status, data } = await req(handler, '/api/summary?period=all')
    expect(status).toBe(200)
    const d = (data as Record<string, unknown>)['data'] as Record<string, unknown>
    expect(typeof d['total_usd']).toBe('number')
    expect(typeof d['sessions']).toBe('number')
  })

  it('GET /api/sessions returns sessions array', async () => {
    const { status, data } = await req(handler, '/api/sessions')
    expect(status).toBe(200)
    expect(Array.isArray((data as Record<string, unknown>)['data'])).toBe(true)
  })

  it('GET /api/sessions supports search across session id, agent, and project name', async () => {
    let response = await req(handler, '/api/sessions?search=proj-a')
    expect(response.status).toBe(200)
    expect(((response.data as Record<string, unknown>)['data'] as unknown[]).length).toBe(1)

    response = await req(handler, '/api/sessions?search=claude')
    expect(((response.data as Record<string, unknown>)['data'] as unknown[]).length).toBe(1)

    response = await req(handler, '/api/sessions?search=sess-1')
    expect(((response.data as Record<string, unknown>)['data'] as unknown[]).length).toBe(1)
  })

  it('GET /api/sessions supports compact field selection', async () => {
    const { status, data } = await req(handler, '/api/sessions?fields=id,total_cost_usd')
    expect(status).toBe(200)
    const sessions = (data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(sessions[0]).toEqual({ id: 'sess-1', total_cost_usd: 1.5 })
  })

  it('GET /api/top returns top sessions', async () => {
    const { status, data } = await req(handler, '/api/top?n=5')
    expect(status).toBe(200)
    expect(Array.isArray((data as Record<string, unknown>)['data'])).toBe(true)
  })

  it('GET /api/models returns model breakdown', async () => {
    const { status, data } = await req(handler, '/api/models')
    expect(status).toBe(200)
    expect(Array.isArray((data as Record<string, unknown>)['data'])).toBe(true)
  })

  it('GET /api/billing returns provider billing totals', async () => {
    upsertBillingDaily(db, {
      date: NOW.substring(0, 10),
      provider: 'openai',
      description: 'codex',
      cost_usd: 12.34,
      updated_at: NOW,
    })
    const { status, data } = await req(handler, '/api/billing?period=all')
    expect(status).toBe(200)
    const d = (data as Record<string, unknown>)['data'] as Record<string, unknown>
    expect(d['total_usd']).toBeCloseTo(12.34)
    expect((d['by_provider'] as Record<string, number>)['openai']).toBeCloseTo(12.34)
  })

  it('POST /api/billing/sync validates days', async () => {
    const { status, data } = await req(handler, '/api/billing/sync', 'POST', { days: 0 })
    expect(status).toBe(400)
    expect((data as Record<string, unknown>)['error']).toBe('days must be between 1 and 366')
  })

  it('POST /api/billing/sync validates providers', async () => {
    const { status, data } = await req(handler, '/api/billing/sync', 'POST', { days: 7, providers: ['unknown'] })
    expect(status).toBe(400)
    expect((data as Record<string, unknown>)['error']).toBe('invalid billing provider')
  })

  it('POST /api/billing/sync reports provider errors without failing the whole sync', async () => {
    const { status, data } = await req(handler, '/api/billing/sync', 'POST', { days: 7, providers: ['anthropic', 'gemini'] })
    expect(status).toBe(200)
    const result = (data as Record<string, unknown>)['data'] as Record<string, Record<string, string | number>>
    expect(String(result['anthropic']?.['error'])).toContain('Missing Anthropic admin key')
    expect(String(result['gemini']?.['skipped'])).toContain('Gemini billing export path')
  })

  it('GET /api/projects returns project breakdown', async () => {
    const { status, data } = await req(handler, '/api/projects')
    expect(status).toBe(200)
    expect(Array.isArray((data as Record<string, unknown>)['data'])).toBe(true)
  })

  it('GET /api/breakdown returns model and project aliases', async () => {
    let response = await req(handler, '/api/breakdown')
    expect(response.status).toBe(200)
    expect(Array.isArray((response.data as Record<string, unknown>)['data'])).toBe(true)

    response = await req(handler, '/api/breakdown?by=project')
    expect(response.status).toBe(200)
    const projects = (response.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(projects[0]?.['project_path']).toBe('/proj/a')
  })

  it('manages project registry records', async () => {
    let response = await req(handler, '/api/project-registry', 'POST', {
      path: '/workspace/new-project',
      tags: ['sdk', 'dashboard'],
    })
    expect(response.status).toBe(200)

    response = await req(handler, '/api/project-registry')
    const projects = (response.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(projects.some(project => project['path'] === '/workspace/new-project' && project['name'] === 'new-project')).toBe(true)

    response = await req(handler, `/api/project-registry/${encodeURIComponent('/workspace/new-project')}`, 'DELETE')
    expect(response.status).toBe(200)
    response = await req(handler, '/api/project-registry')
    const afterDelete = (response.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(afterDelete.some(project => project['path'] === '/workspace/new-project')).toBe(false)
  })

  it('GET /api/budgets returns budgets with status', async () => {
    const { status, data } = await req(handler, '/api/budgets')
    expect(status).toBe(200)
    const d = (data as Record<string, unknown>)['data'] as unknown[]
    expect(d.length).toBeGreaterThan(0)
    expect((d[0] as Record<string, unknown>)['percent_used']).toBeDefined()
  })

  it('POST /api/budgets creates a budget', async () => {
    const { status } = await req(handler, '/api/budgets', 'POST', {
      period: 'daily', limit_usd: 10, alert_at_percent: 70,
    })
    expect(status).toBe(200)
  })

  it('POST /api/budgets rejects invalid numeric input', async () => {
    const { status, data } = await req(handler, '/api/budgets', 'POST', {
      period: 'daily', limit_usd: 'not-a-number',
    })
    expect(status).toBe(400)
    expect((data as Record<string, unknown>)['error']).toBe('limit_usd must be a positive number')
  })

  it('POST /api/budgets normalizes day/week/month aliases', async () => {
    const { status } = await req(handler, '/api/budgets', 'POST', {
      period: 'month', limit_usd: 15,
    })
    expect(status).toBe(200)

    const latest = db.prepare(`SELECT period FROM budgets ORDER BY created_at DESC LIMIT 1`).get() as { period: string } | null
    expect(latest?.period).toBe('monthly')
  })

  it('DELETE /api/budgets/:id removes a budget', async () => {
    const { status } = await req(handler, '/api/budgets/bud-1', 'DELETE')
    expect(status).toBe(200)
  })

  it('GET /api/pricing returns pricing', async () => {
    const { status, data } = await req(handler, '/api/pricing')
    expect(status).toBe(200)
    expect(Array.isArray((data as Record<string, unknown>)['data'])).toBe(true)
  })

  it('POST /api/pricing creates/updates pricing', async () => {
    const { status } = await req(handler, '/api/pricing', 'POST', {
      model: 'new-model', input_per_1m: 5, output_per_1m: 20,
      cache_read_per_1m: 0.5, cache_write_per_1m: 0, cache_write_1h_per_1m: 0,
    })
    expect(status).toBe(200)
  })

  it('POST /api/pricing rejects invalid pricing payloads', async () => {
    const { status, data } = await req(handler, '/api/pricing', 'POST', {
      model: '', input_per_1m: -1, output_per_1m: 20,
    })
    expect(status).toBe(400)
    expect((data as Record<string, unknown>)['error']).toBe('model is required')
  })

  it('POST /api/pricing rejects negative or non-numeric rates', async () => {
    const { status, data } = await req(handler, '/api/pricing', 'POST', {
      model: 'bad-model', input_per_1m: -1, output_per_1m: 20,
    })
    expect(status).toBe(400)
    expect((data as Record<string, unknown>)['error']).toBe('pricing values must be non-negative numbers')
  })

  it('DELETE /api/pricing/:model removes a pricing row', async () => {
    const { status } = await req(handler, '/api/pricing/claude-sonnet-4-6', 'DELETE')
    expect(status).toBe(200)
    const row = db.prepare(`SELECT model FROM model_pricing WHERE model = ?`).get('claude-sonnet-4-6')
    expect(row).toBeNull()
  })

  it('POST /api/sync rejects invalid source', async () => {
    const { status, data } = await req(handler, '/api/sync', 'POST', { sources: 'bad-source' })
    expect(status).toBe(400)
    expect((data as Record<string, unknown>)['error']).toBe('invalid sync source')
  })

  it('GET /api/sessions/:id/requests returns request detail and 404s missing sessions', async () => {
    let response = await req(handler, '/api/sessions/sess-1/requests')
    expect(response.status).toBe(200)
    const requests = (response.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(requests[0]?.['id']).toBe('req-1')
    expect(((response.data as Record<string, unknown>)['meta'] as Record<string, unknown>)['count']).toBe(1)

    response = await req(handler, '/api/sessions/missing/requests')
    expect(response.status).toBe(404)
    expect((response.data as Record<string, unknown>)['error']).toBe('Session not found')
  })

  it('manages spending goals', async () => {
    let response = await req(handler, '/api/goals', 'POST', {
      period: 'month',
      project_path: '/proj/a',
      limit_usd: 25,
    })
    expect(response.status).toBe(200)

    response = await req(handler, '/api/goals')
    expect(response.status).toBe(200)
    const goals = (response.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(goals.some(goal => goal['project_path'] === '/proj/a' && goal['limit_usd'] === 25)).toBe(true)

    const id = (db.prepare(`SELECT id FROM goals WHERE project_path = ?`).get('/proj/a') as { id: string }).id
    response = await req(handler, `/api/goals/${id}`, 'DELETE')
    expect(response.status).toBe(200)
    response = await req(handler, '/api/goals')
    const afterDelete = (response.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(afterDelete.some(goal => goal['id'] === id)).toBe(false)
  })

  it('GET /api/daily returns daily data', async () => {
    const { status, data } = await req(handler, '/api/daily?days=7')
    expect(status).toBe(200)
    expect(Array.isArray((data as Record<string, unknown>)['data'])).toBe(true)
  })

  it('OPTIONS returns 204 with CORS headers', async () => {
    const r = new Request('http://localhost:3456/api/summary', { method: 'OPTIONS' })
    const res = await handler(r)
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('returns 404 for unknown routes', async () => {
    const { status, data } = await req(handler, '/api/unknown-route')
    expect(status).toBe(404)
    expect((data as Record<string, unknown>)['error']).toBeDefined()
  })

  it('CORS headers present on all responses', async () => {
    const r = new Request('http://localhost:3456/health')
    const res = await handler(r)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('GET /api/machines returns machine list', async () => {
    const { status, data } = await req(handler, '/api/machines')
    expect(status).toBe(200)
    expect(Array.isArray((data as Record<string, unknown>)['data'])).toBe(true)
  })

  it('GET /api/summary?machine= filters by machine', async () => {
    upsertRequest(db, {
      id: 'req-m1', agent: 'claude', session_id: 'sess-m1', model: 'claude-sonnet-4-6',
      input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_create_tokens: 0,
      cost_usd: 0.5, duration_ms: 100, timestamp: NOW, source_request_id: 'src-m1', machine_id: 'apple01',
    })
    upsertSession(db, {
      id: 'sess-m1', agent: 'claude', project_path: '/proj/m', project_name: 'proj-m',
      started_at: NOW, ended_at: null, total_cost_usd: 0.5, total_tokens: 150, request_count: 1, machine_id: 'apple01',
    })
    const { data } = await req(handler, '/api/summary?period=all&machine=apple01')
    const d = (data as Record<string, unknown>)['data'] as Record<string, unknown>
    expect(d['total_usd']).toBeCloseTo(0.5)
  })

  it('GET /api/sessions?machine= filters by machine', async () => {
    upsertSession(db, {
      id: 'sess-m2', agent: 'claude', project_path: '/proj/m2', project_name: 'proj-m2',
      started_at: NOW, ended_at: null, total_cost_usd: 0.5, total_tokens: 150, request_count: 1, machine_id: 'apple03',
    })
    const { data } = await req(handler, '/api/sessions?machine=apple03')
    const sessions = (data as Record<string, unknown>)['data'] as unknown[]
    expect(sessions.length).toBe(1)
  })
})
