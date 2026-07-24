import { describe, it, expect, beforeEach } from 'bun:test'
import { openDatabase, upsertRequest, upsertSession } from '../db/database.js'
import { createHandler } from './serve.js'
import type { SqliteAdapter as Database } from '@hasna/cloud'

const NOW = new Date().toISOString()
const TODAY = NOW.substring(0, 10)

function makeDb(): Database {
  return openDatabase(':memory:', true)
}

function seed(db: Database) {
  upsertSession(db, {
    id: 'sess-a', agent: 'claude', project_path: '/proj/alpha', project_name: 'alpha',
    started_at: NOW, ended_at: null, total_cost_usd: 2, total_tokens: 4000, request_count: 2,
  })
  upsertRequest(db, {
    id: 'req-a', agent: 'claude', session_id: 'sess-a', model: 'claude-sonnet-4-6',
    input_tokens: 1000, output_tokens: 500, cache_read_tokens: 200, cache_create_tokens: 100,
    cost_usd: 2, cost_basis: 'metered_api', duration_ms: 1000, timestamp: NOW, source_request_id: 'src-a',
  })
}

async function get(handler: (r: Request) => Promise<Response>, path: string): Promise<{ status: number; data: unknown }> {
  const res = await handler(new Request(`http://localhost:3456${path}`))
  return { status: res.status, data: (await res.json()) as unknown }
}

describe('analytics serve endpoints', () => {
  let db: Database
  let handler: (r: Request) => Promise<Response>

  beforeEach(() => {
    db = makeDb()
    seed(db)
    handler = createHandler(db)
  })

  it('GET /api/brief returns a fleet brief', async () => {
    const { status, data } = await get(handler, '/api/brief?since=7d')
    expect(status).toBe(200)
    const brief = (data as { data: { summaries: unknown[] } }).data
    expect(Array.isArray(brief.summaries)).toBe(true)
    expect(brief.summaries.length).toBe(3)
  })

  it('GET /api/projects/detail returns matched project', async () => {
    const { status, data } = await get(handler, '/api/projects/detail?q=alpha')
    expect(status).toBe(200)
    const detail = (data as { data: { project_name: string; total_cost_usd: number } }).data
    expect(detail.project_name).toBe('alpha')
    expect(detail.total_cost_usd).toBe(2)
  })

  it('GET /api/projects/detail requires q', async () => {
    const { status } = await get(handler, '/api/projects/detail')
    expect(status).toBe(400)
  })

  it('GET /api/export returns request rows', async () => {
    const { status, data } = await get(handler, '/api/export?type=requests&period=all')
    expect(status).toBe(200)
    const rows = (data as { data: Array<{ id: string }> }).data
    expect(rows.some(r => r.id === 'req-a')).toBe(true)
  })

  it('GET /api/export rejects bad type', async () => {
    const { status } = await get(handler, '/api/export?type=bogus')
    expect(status).toBe(400)
  })

  it('GET /api/compare returns range stats', async () => {
    const { status, data } = await get(handler, `/api/compare?from=${TODAY}&to=${TODAY}`)
    expect(status).toBe(200)
    const stats = (data as { data: { cost: number; requests: number } }).data
    expect(stats.cost).toBe(2)
    expect(stats.requests).toBe(1)
  })

  it('GET /api/compare requires from and to', async () => {
    const { status } = await get(handler, '/api/compare?from=2020-01-01')
    expect(status).toBe(400)
  })

  it('GET /api/forecast returns projection fields', async () => {
    const { status, data } = await get(handler, '/api/forecast')
    expect(status).toBe(200)
    const f = (data as { data: { days_in_month: number; spent_so_far_usd: number } }).data
    expect(f.days_in_month).toBeGreaterThan(27)
    expect(f.spent_so_far_usd).toBeGreaterThanOrEqual(0)
  })

  it('GET /api/efficiency returns per-model rows', async () => {
    const { status, data } = await get(handler, '/api/efficiency')
    expect(status).toBe(200)
    const rows = (data as { data: Array<{ model: string; output: number; cache_read: number }> }).data
    const row = rows.find(r => r.model === 'claude-sonnet-4-6')
    expect(row?.output).toBe(500)
    expect(row?.cache_read).toBe(200)
  })

  it('GET /api/requests returns rows since a timestamp', async () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const { status, data } = await get(handler, `/api/requests?since=${encodeURIComponent(past)}`)
    expect(status).toBe(200)
    const rows = (data as { data: Array<{ id: string }> }).data
    expect(rows.some(r => r.id === 'req-a')).toBe(true)
  })

  it('GET /api/requests requires since', async () => {
    const { status } = await get(handler, '/api/requests')
    expect(status).toBe(400)
  })
})
