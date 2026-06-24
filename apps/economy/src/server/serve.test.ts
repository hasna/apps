import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { openDatabase, upsertRequest, upsertSession, upsertBudget, upsertGoal, upsertModelPricing, upsertBillingDaily, upsertUsageSnapshot, upsertCostCenter, upsertLoopAttribution } from '../db/database.js'
import { createHandler, createServerFetch, startServer } from './serve.js'
import type { SqliteAdapter as Database } from '@hasna/cloud'
import { Database as BunDatabase } from 'bun:sqlite'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AGENTS } from '../lib/agents.js'

const NOW = new Date().toISOString()
const roots: string[] = []
const SYNC_ENV_KEYS = [
  'HASNA_ECONOMY_CODEX_DB_PATH',
  'HASNA_ECONOMY_CODEX_CONFIG_PATH',
  'HASNA_ECONOMY_GEMINI_TMP_DIR',
  'HASNA_ECONOMY_GEMINI_HISTORY_DIR',
] as const

function makeDb(): Database {
  return openDatabase(':memory:', true)
}

function seedData(db: Database) {
  upsertSession(db, {
    id: 'sess-1', agent: 'claude', project_path: '/proj/a', project_name: 'proj-a',
    started_at: NOW, ended_at: null, total_cost_usd: 1.5, total_tokens: 5000, request_count: 3,
    account_key: 'claude:work', account_tool: 'claude', account_name: 'work',
    account_email: 'work@example.com', account_source: 'current',
  })
  upsertRequest(db, {
    id: 'req-1', agent: 'claude', session_id: 'sess-1', model: 'claude-sonnet-4-6',
    input_tokens: 1000, output_tokens: 500, cache_read_tokens: 0, cache_create_tokens: 0,
    cost_usd: 1.5, cost_basis: 'metered_api', duration_ms: 2000, timestamp: NOW, source_request_id: 'src-1',
    account_key: 'claude:work', account_tool: 'claude', account_name: 'work',
    account_email: 'work@example.com', account_source: 'current',
  })
  upsertCostCenter(db, {
    id: 'loop:fleet-evaluator',
    kind: 'loop',
    name: 'fleet-evaluator',
    repo_path: null,
    labels_json: '{}',
    created_at: NOW,
  })
  upsertSession(db, {
    id: 'loop-session', agent: 'loop', project_path: '', project_name: 'fleet-evaluator',
    started_at: '2000-01-01T00:00:00.000Z', ended_at: null, total_cost_usd: 0, total_tokens: 0, request_count: 0,
    cost_center_id: 'loop:fleet-evaluator',
  })
  upsertRequest(db, {
    id: 'loop-req', agent: 'loop', session_id: 'loop-session', model: 'gpt-5-codex',
    input_tokens: 50, output_tokens: 0, cache_read_tokens: 0, cache_create_tokens: 0,
    cost_usd: 0.01, cost_basis: 'estimated', duration_ms: 0, timestamp: NOW, source_request_id: 'loop-req',
    cost_center_id: 'loop:fleet-evaluator',
  })
  upsertLoopAttribution(db, {
    id: 'loop-attr-1',
    request_id: 'loop-req',
    session_id: 'loop-session',
    loop_id: 'loop-123',
    loop_name: 'fleet-evaluator',
    loop_run_id: 'run-123',
    goal_id: 'goal-123',
    goal_run_id: 'goal-run-123',
    workflow_run_id: 'workflow-run-123',
    workflow_step_id: 'workflow-step-123',
    thread_id: 'thread-123',
    account_key: 'codex:pro',
    account_tool: 'codex',
    account_name: 'Codex Pro',
    provider: 'codex',
    model: 'gpt-5-codex',
    phase: 'judge',
    status: 'failed',
    loop_status: 'failed',
    schedule_json: '{"type":"interval","minutes":15}',
    scheduled_for: NOW,
    started_at: NOW,
    finished_at: NOW,
    duration_ms: 123000,
    attempt: 2,
    tokens: 372,
    api_equivalent_usd: 0.004185,
    subscription_included_usd: 0.004185,
    billable_usd: 0,
    failure_retry_usd: 0.004185,
    cost_basis: 'subscription_included',
    machine_id: 'spark02',
    created_at: NOW,
    updated_at: NOW,
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

async function req(
  handler: (r: Request) => Promise<Response>,
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: unknown }> {
  const r = new Request(`http://localhost:3456${path}`, {
    method,
    headers: body
      ? { 'Content-Type': 'application/json', ...headers }
      : headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const res = await handler(r)
  const json = await res.json() as unknown
  return { status: res.status, data: json }
}

async function rawReq(handler: (r: Request) => Promise<Response>, path: string, method: string, body: string): Promise<{ status: number; data: unknown }> {
  const r = new Request(`http://localhost:3456${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body,
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

  afterEach(() => {
    for (const key of SYNC_ENV_KEYS) delete process.env[key]
    for (const root of roots.splice(0)) {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true })
    }
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

  it('GET /api/sessions supports account filters', async () => {
    const response = await req(handler, '/api/sessions?account=work@example.com')

    expect(response.status).toBe(200)
    const sessions = (response.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.['account_key']).toBe('claude:work')
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

  it('GET /api/billing/diff returns estimated vs actual delta', async () => {
    const { status, data } = await req(handler, '/api/billing/diff?period=month')
    expect(status).toBe(200)
    const d = (data as Record<string, unknown>)['data'] as Record<string, unknown>
    expect(typeof d['estimated_usd']).toBe('number')
    expect(typeof d['actual_usd']).toBe('number')
    expect(typeof d['is_alert']).toBe('boolean')
  })

  it('rejects API requests without token when ECONOMY_API_TOKEN is set', async () => {
    process.env['ECONOMY_API_TOKEN'] = 'test-token'
    try {
      const authed = await req(handler, '/api/summary?period=today', 'GET', undefined, {
        Authorization: 'Bearer test-token',
      })
      expect(authed.status).toBe(200)

      const denied = await req(handler, '/api/summary?period=today')
      expect(denied.status).toBe(401)

      const health = await req(handler, '/health')
      expect(health.status).toBe(200)
    } finally {
      delete process.env['ECONOMY_API_TOKEN']
    }
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

  it('GET /api/projects supports period filters', async () => {
    upsertSession(db, {
      id: 'old-project', agent: 'claude', project_path: '/proj/old', project_name: 'proj-old',
      started_at: '2000-01-01T00:00:00.000Z', ended_at: null, total_cost_usd: 100, total_tokens: 1000, request_count: 1,
    })

    const { status, data } = await req(handler, '/api/projects?period=month')

    expect(status).toBe(200)
    const rows = (data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(rows.map(row => row['project_name'])).not.toContain('proj-old')
    expect(rows.map(row => row['project_name'])).toContain('proj-a')
  })

  it('GET /api/accounts returns account breakdown', async () => {
    const { status, data } = await req(handler, '/api/accounts?period=all')

    expect(status).toBe(200)
    const accounts = (data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(accounts[0]).toMatchObject({
      account_key: 'claude:work@example.com',
      account_tool: 'claude',
      account_name: 'work',
      account_email: 'work@example.com',
      sessions: 1,
      requests: 1,
      api_equivalent_usd: 1.5,
      billable_usd: 1.5,
      metered_api_usd: 1.5,
      subscription_included_usd: 0,
    })
  })

  it('GET /api/loops returns exact loop attribution rows with filters', async () => {
    const { status, data } = await req(handler, '/api/loops?since=99999d&loop=fleet&provider=codex&account=pro&model=gpt-5&machine=spark02&limit=1')

    expect(status).toBe(200)
    const payload = (data as Record<string, unknown>)['data'] as Record<string, unknown>
    expect(payload['total_rows']).toBe(1)
    expect((payload['filters'] as Record<string, unknown>)['since']).not.toBe('99999d')
    const rows = payload['rows'] as Array<Record<string, unknown>>
    expect(rows[0]).toMatchObject({
      loop_id: 'loop-123',
      loop_name: 'fleet-evaluator',
      loop_run_id: 'run-123',
      session_id: 'loop-session',
      thread_id: 'thread-123',
      account_key: 'codex:pro',
      provider: 'codex',
      model: 'gpt-5-codex',
      tokens: 372,
      subscription_included_usd: 0.004185,
      billable_usd: 0,
      failure_retry_usd: 0.004185,
    })
  })

  it('GET /api/efficiency returns loop summary and provider readiness', async () => {
    const { status, data } = await req(handler, '/api/efficiency?loop=fleet')

    expect(status).toBe(200)
    const payload = (data as Record<string, unknown>)['data'] as Record<string, unknown>
    const loops = payload['loops'] as Record<string, unknown>
    expect((loops['totals'] as Record<string, unknown>)['tokens']).toBe(372)
    expect((loops['by_loop'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      loop_id: 'loop-123',
      loop_name: 'fleet-evaluator',
      failed_runs: 1,
      retry_runs: 1,
    })
    const readiness = payload['provider_readiness'] as Record<string, unknown>
    expect((readiness['providers'] as Array<Record<string, unknown>>).map(row => row['provider'])).toEqual([
      'codewith',
      'codex',
      'claude',
      'cursor',
      'aicopilot',
      'opencode',
      'gemini',
    ])
  })

  it('manages subscriptions through the REST API', async () => {
    const created = await req(handler, '/api/subscriptions', 'POST', {
      id: 'sub-1',
      provider: 'cursor',
      plan: 'pro',
      agent: 'cursor',
      monthly_fee_usd: 20,
      included_usage_usd: 20,
      billing_cycle_start: '2026-06-01',
    })

    expect(created.status).toBe(200)
    expect((created.data as Record<string, unknown>)['data']).toMatchObject({
      id: 'sub-1',
      provider: 'cursor',
      plan: 'pro',
      agent: 'cursor',
      monthly_fee_usd: 20,
      included_usage_usd: 20,
      active: 1,
    })

    const listed = await req(handler, '/api/subscriptions')
    const rows = (listed.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(rows.map(row => row['id'])).toContain('sub-1')

    const invalidAgent = await req(handler, '/api/subscriptions', 'POST', {
      provider: 'cursor',
      plan: 'pro',
      agent: 'unknown',
    })
    expect(invalidAgent.status).toBe(400)

    const removed = await req(handler, '/api/subscriptions/sub-1', 'DELETE')
    expect(removed.status).toBe(200)
    const afterRemove = await req(handler, '/api/subscriptions')
    expect(((afterRemove.data as Record<string, unknown>)['data'] as unknown[]).length).toBe(0)
  })

  it('GET /api/usage filters snapshots by period', async () => {
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
      date: NOW.substring(0, 10),
      metric: 'included_consumed_usd',
      value: 2,
      unit: 'usd',
      machine_id: 'test-machine',
    })

    const today = await req(handler, '/api/usage?period=today&agent=cursor')
    const todaySnapshots = ((today.data as Record<string, unknown>)['data'] as Record<string, unknown>)['snapshots'] as Array<Record<string, unknown>>
    expect(todaySnapshots.map(row => row['value'])).toEqual([2])

    const all = await req(handler, '/api/usage?period=all&agent=cursor')
    const allSnapshots = ((all.data as Record<string, unknown>)['data'] as Record<string, unknown>)['snapshots'] as Array<Record<string, unknown>>
    expect(allSnapshots.map(row => row['value']).sort()).toEqual([1, 2])
  })

  it('GET /api/breakdown returns model and project aliases', async () => {
    let response = await req(handler, '/api/breakdown')
    expect(response.status).toBe(200)
    expect(Array.isArray((response.data as Record<string, unknown>)['data'])).toBe(true)

    response = await req(handler, '/api/breakdown?by=project')
    expect(response.status).toBe(200)
    const projects = (response.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(projects[0]?.['project_path']).toBe('/proj/a')

    response = await req(handler, '/api/breakdown?by=agent&period=all')
    expect(response.status).toBe(200)
    const agents = (response.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(agents[0]?.['agent']).toBe('claude')
    expect(agents[0]?.['billable_usd']).toBe(1.5)

    response = await req(handler, '/api/breakdown?by=account&period=all')
    expect(response.status).toBe(200)
    const accounts = (response.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(accounts[0]?.['account_key']).toBe('claude:work@example.com')
    expect(accounts[0]?.['billable_usd']).toBe(1.5)

    response = await req(handler, '/api/breakdown?by=cost-center&period=all')
    expect(response.status).toBe(200)
    const costCenters = (response.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(costCenters.some(row => row['name'] === 'fleet-evaluator' && row['kind'] === 'loop')).toBe(true)

    response = await req(handler, '/api/breakdown?by=loop&period=all')
    expect(response.status).toBe(200)
    const loops = (response.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(loops.every(row => row['kind'] === 'loop')).toBe(true)
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

  it('POST /api/project-registry rejects invalid payloads', async () => {
    let response = await rawReq(handler, '/api/project-registry', 'POST', '{bad json')
    expect(response.status).toBe(400)
    expect((response.data as Record<string, unknown>)['error']).toBe('invalid JSON body')

    response = await req(handler, '/api/project-registry', 'POST', { name: 'Missing Path' })
    expect(response.status).toBe(400)
    expect((response.data as Record<string, unknown>)['error']).toBe('path is required')
  })

  it('GET /api/budgets returns budgets with status', async () => {
    const { status, data } = await req(handler, '/api/budgets')
    expect(status).toBe(200)
    const d = (data as Record<string, unknown>)['data'] as unknown[]
    expect(d.length).toBeGreaterThan(0)
    expect((d[0] as Record<string, unknown>)['percent_used']).toBeDefined()
  })

  it('POST /api/budgets creates a budget', async () => {
    const { status, data } = await req(handler, '/api/budgets', 'POST', {
      period: 'daily', limit_usd: 10, alert_at_percent: 70, cost_center_id: 'loop:fleet-evaluator',
    })
    expect(status).toBe(200)
    const budget = (data as Record<string, unknown>)['data'] as Record<string, unknown>
    expect(budget['id']).toBeString()
    expect(budget['period']).toBe('daily')
    expect(budget['cost_center_id']).toBe('loop:fleet-evaluator')
    expect(budget['limit_usd']).toBe(10)
    expect(budget['current_spend_usd']).toBeNumber()
    expect(budget['percent_used']).toBeNumber()
  })

  it('POST /api/budgets rejects invalid numeric input', async () => {
    let response = await req(handler, '/api/budgets', 'POST', {
      period: 'daily', limit_usd: 'not-a-number',
    })
    expect(response.status).toBe(400)
    expect((response.data as Record<string, unknown>)['error']).toBe('limit_usd must be a positive number')

    response = await req(handler, '/api/budgets', 'POST', {
      period: 'daily', limit_usd: 10, agent: 'unknown',
    })
    expect(response.status).toBe(400)
    expect((response.data as Record<string, unknown>)['error']).toBe(`agent must be one of: ${AGENTS.join(', ')}`)
  })

  it('POST /api/budgets normalizes day/week/month aliases', async () => {
    for (const [period, normalized] of [['day', 'daily'], ['week', 'weekly'], ['month', 'monthly']] as const) {
      const { status, data } = await req(handler, '/api/budgets', 'POST', { period, limit_usd: 15 })
      expect(status).toBe(200)

      const budget = (data as Record<string, unknown>)['data'] as Record<string, unknown>
      expect(budget['period']).toBe(normalized)
    }
  })

  it('DELETE /api/budgets/:id removes a budget', async () => {
    const { status } = await req(handler, '/api/budgets/bud-1', 'DELETE')
    expect(status).toBe(200)
  })

  it('DELETE path params decode encoded budget and goal ids', async () => {
    upsertBudget(db, {
      id: 'bud/with spaces', project_path: null, agent: null, period: 'monthly',
      limit_usd: 100, alert_at_percent: 80, created_at: NOW, updated_at: NOW,
    })
    upsertGoal(db, {
      id: 'goal/with spaces', project_path: null, agent: null, period: 'month',
      limit_usd: 50, created_at: NOW, updated_at: NOW,
    })

    let response = await req(handler, `/api/budgets/${encodeURIComponent('bud/with spaces')}`, 'DELETE')
    expect(response.status).toBe(200)
    let row = db.prepare(`SELECT id FROM budgets WHERE id = ?`).get('bud/with spaces')
    expect(row).toBeNull()

    response = await req(handler, `/api/goals/${encodeURIComponent('goal/with spaces')}`, 'DELETE')
    expect(response.status).toBe(200)
    row = db.prepare(`SELECT id FROM goals WHERE id = ?`).get('goal/with spaces')
    expect(row).toBeNull()
  })

  it('GET /api/pricing returns pricing', async () => {
    const { status, data } = await req(handler, '/api/pricing')
    expect(status).toBe(200)
    expect(Array.isArray((data as Record<string, unknown>)['data'])).toBe(true)
  })

  it('POST /api/pricing creates/updates pricing', async () => {
    const { status, data } = await req(handler, '/api/pricing', 'POST', {
      model: 'new-model', input_per_1m: 5, output_per_1m: 20,
      cache_read_per_1m: 0.5, cache_write_per_1m: 0, cache_write_1h_per_1m: 0, cache_storage_per_1m_hour: 4.5,
    })
    expect(status).toBe(200)
    const pricing = (data as Record<string, unknown>)['data'] as Record<string, unknown>
    expect(pricing['model']).toBe('new-model')
    expect(pricing['input_per_1m']).toBe(5)
    expect(pricing['output_per_1m']).toBe(20)
    expect(pricing['cache_storage_per_1m_hour']).toBe(4.5)
  })

  it('POST /api/pricing rejects invalid pricing payloads', async () => {
    const { status, data } = await req(handler, '/api/pricing', 'POST', {
      model: '', input_per_1m: -1, output_per_1m: 20,
    })
    expect(status).toBe(400)
    expect((data as Record<string, unknown>)['error']).toBe('model is required')
  })

  it('POST /api/pricing rejects negative or non-numeric rates', async () => {
    let response = await req(handler, '/api/pricing', 'POST', {
      model: 'bad-model', input_per_1m: -1, output_per_1m: 20,
    })
    expect(response.status).toBe(400)
    expect((response.data as Record<string, unknown>)['error']).toBe('pricing values must be non-negative numbers')

    response = await req(handler, '/api/pricing', 'POST', {
      model: 'bad-model', input_per_1m: 1, output_per_1m: 20, cache_storage_per_1m_hour: -0.1,
    })
    expect(response.status).toBe(400)
    expect((response.data as Record<string, unknown>)['error']).toBe('pricing values must be non-negative numbers')
  })

  it('POST /api/pricing rejects malformed JSON', async () => {
    const { status, data } = await rawReq(handler, '/api/pricing', 'POST', '{bad json')
    expect(status).toBe(400)
    expect((data as Record<string, unknown>)['error']).toBe('invalid JSON body')
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

  it('POST /api/sync runs Codex ingestion through the REST handler', async () => {
    const root = mkdtempSync(join(tmpdir(), 'economy-rest-codex-sync-'))
    roots.push(root)
    const codexDbPath = join(root, 'state_5.sqlite')
    const rolloutPath = join(root, 'rollout.jsonl')
    process.env['HASNA_ECONOMY_CODEX_DB_PATH'] = codexDbPath
    process.env['HASNA_ECONOMY_CODEX_CONFIG_PATH'] = join(root, 'config.toml')

    writeFileSync(rolloutPath, JSON.stringify({
      timestamp: '2026-05-08T10:00:00.000Z',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 250,
            output_tokens: 500,
            total_tokens: 1500,
          },
        },
      },
    }) + '\n')

    const codexDb = new BunDatabase(codexDbPath)
    codexDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT,
        cwd TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        title TEXT,
        model_provider TEXT,
        model TEXT
      )
    `)
    codexDb.prepare(`
      INSERT INTO threads
        (id, rollout_path, cwd, created_at, updated_at, tokens_used, title, model_provider, model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('rest-thread', rolloutPath, '/tmp/rest-codex-project', 1715162400, 1715162401, 1500, 'REST thread', 'openai', 'gpt-5-codex')
    codexDb.close()

    const { status, data } = await req(handler, '/api/sync', 'POST', { sources: 'codex' })

    expect(status).toBe(200)
    const result = (data as Record<string, unknown>)['data'] as Record<string, Record<string, number>>
    expect(result['codex']).toEqual({ sessions: 1, requests: 1 })
    const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get('codex-rest-thread') as Record<string, unknown> | null
    const request = db.prepare(`SELECT * FROM requests WHERE session_id = ?`).get('codex-rest-thread') as Record<string, unknown> | null
    expect(session?.['agent']).toBe('codex')
    expect(request?.['model']).toBe('gpt-5-codex')
    expect(request?.['cache_read_tokens']).toBe(250)
  })

  it('POST /api/sync runs Gemini ingestion through the REST handler', async () => {
    const root = mkdtempSync(join(tmpdir(), 'economy-rest-gemini-sync-'))
    roots.push(root)
    const tmpRoot = join(root, 'tmp')
    const historyRoot = join(root, 'history')
    const projectDir = join(historyRoot, 'rest-project')
    const chatsDir = join(projectDir, 'chats')
    mkdirSync(chatsDir, { recursive: true })
    process.env['HASNA_ECONOMY_GEMINI_TMP_DIR'] = tmpRoot
    process.env['HASNA_ECONOMY_GEMINI_HISTORY_DIR'] = historyRoot

    writeFileSync(join(projectDir, '.project_root'), '/tmp/rest-gemini-project')
    writeFileSync(join(chatsDir, 'chat.json'), JSON.stringify({
      sessionId: 'gemini-rest-session',
      model: 'gemini-2.5-flash',
      startTime: '2026-05-08T11:00:00.000Z',
      lastUpdated: '2026-05-08T11:00:10.000Z',
      messages: [{
        id: 'msg-1',
        timestamp: '2026-05-08T11:00:01.000Z',
        usageMetadata: {
          promptTokenCount: 1200,
          cachedContentTokenCount: 200,
          candidatesTokenCount: 400,
          thoughtsTokenCount: 50,
          totalTokenCount: 1650,
        },
        response: { modelVersion: 'gemini-2.5-flash' },
      }],
    }))

    const { status, data } = await req(handler, '/api/sync', 'POST', { sources: 'gemini' })

    expect(status).toBe(200)
    const result = (data as Record<string, unknown>)['data'] as Record<string, Record<string, number>>
    expect(result['gemini']).toEqual({ sessions: 1, requests: 1 })
    const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get('gemini-rest-session') as Record<string, unknown> | null
    const request = db.prepare(`SELECT * FROM requests WHERE session_id = ?`).get('gemini-rest-session') as Record<string, unknown> | null
    expect(session?.['project_path']).toBe('/tmp/rest-gemini-project')
    expect(request?.['model']).toBe('gemini-2.5-flash')
    expect(request?.['input_tokens']).toBe(1000)
    expect(request?.['cache_read_tokens']).toBe(200)
    expect(request?.['output_tokens']).toBe(450)
  })

  it('GET /api/sessions/:id/requests returns request detail and 404s missing sessions', async () => {
    let response = await req(handler, '/api/sessions/sess-1/requests')
    expect(response.status).toBe(200)
    const requests = (response.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(requests[0]?.['id']).toBe('req-1')
    expect(((response.data as Record<string, unknown>)['meta'] as Record<string, unknown>)['count']).toBe(1)

    upsertSession(db, {
      id: 'sess/with spaces', agent: 'codex', project_path: '/proj/encoded', project_name: 'encoded',
      started_at: NOW, ended_at: null, total_cost_usd: 0.25, total_tokens: 100, request_count: 1,
    })
    upsertRequest(db, {
      id: 'req-encoded', agent: 'codex', session_id: 'sess/with spaces', model: 'gpt-5-codex',
      input_tokens: 50, output_tokens: 50, cache_read_tokens: 0, cache_create_tokens: 0,
      cost_usd: 0.25, duration_ms: 100, timestamp: NOW, source_request_id: 'src-encoded',
    })

    response = await req(handler, `/api/sessions/${encodeURIComponent('sess/with spaces')}/requests`)
    expect(response.status).toBe(200)
    const encodedRequests = (response.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(encodedRequests[0]?.['id']).toBe('req-encoded')

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
    expect(goals.some(goal => goal['project_path'] === '/proj/a' && typeof goal['percent_used'] === 'number')).toBe(true)

    const id = (db.prepare(`SELECT id FROM goals WHERE project_path = ?`).get('/proj/a') as { id: string }).id
    response = await req(handler, `/api/goals/${id}`, 'DELETE')
    expect(response.status).toBe(200)
    response = await req(handler, '/api/goals')
    const afterDelete = (response.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(afterDelete.some(goal => goal['id'] === id)).toBe(false)
  })

  it('POST /api/goals rejects invalid limit and period', async () => {
    let response = await req(handler, '/api/goals', 'POST', {
      period: 'month',
      limit_usd: 'not-a-number',
    })
    expect(response.status).toBe(400)
    expect((response.data as Record<string, unknown>)['error']).toBe('limit_usd must be a positive number')

    response = await req(handler, '/api/goals', 'POST', {
      period: 'quarter',
      limit_usd: 10,
    })
    expect(response.status).toBe(400)
    expect((response.data as Record<string, unknown>)['error']).toBe('period must be day, week, month, or year')

    response = await req(handler, '/api/goals', 'POST', {
      period: 'month',
      limit_usd: 10,
      agent: 'unknown',
    })
    expect(response.status).toBe(400)
    expect((response.data as Record<string, unknown>)['error']).toBe(`agent must be one of: ${AGENTS.join(', ')}`)
  })

  it('GET /api/daily returns daily data', async () => {
    const { status, data } = await req(handler, '/api/daily?days=7')
    expect(status).toBe(200)
    expect(Array.isArray((data as Record<string, unknown>)['data'])).toBe(true)
  })

  it('GET /api/hourly returns hourly activity for today', async () => {
    const { status, data } = await req(handler, '/api/hourly')
    expect(status).toBe(200)
    const rows = (data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    expect(Array.isArray(rows)).toBe(true)
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty('hour')
      expect(rows[0]).toHaveProperty('cost_usd')
    }
  })

  it('GET /api/hourly validates rolling hour windows', async () => {
    const { status, data } = await req(handler, '/api/hourly?hours=0')

    expect(status).toBe(400)
    expect((data as Record<string, unknown>)['error']).toBe('hours must be between 1 and 48')
  })

  it('GET /api/hourly?machine= filters hourly activity by machine', async () => {
    upsertRequest(db, {
      id: 'hourly-spark', agent: 'claude', session_id: 'hourly-spark-session', model: 'claude-sonnet-4-6',
      input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_create_tokens: 0,
      cost_usd: 1, duration_ms: 100, timestamp: NOW, source_request_id: 'hourly-spark', machine_id: 'spark02',
    })
    upsertRequest(db, {
      id: 'hourly-apple', agent: 'claude', session_id: 'hourly-apple-session', model: 'claude-sonnet-4-6',
      input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_create_tokens: 0,
      cost_usd: 2, duration_ms: 100, timestamp: NOW, source_request_id: 'hourly-apple', machine_id: 'apple06',
    })

    const { status, data } = await req(handler, '/api/hourly?machine=spark02')
    const rows = (data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>
    const totalCost = rows.reduce((sum, row) => sum + Number(row['cost_usd'] ?? 0), 0)

    expect(status).toBe(200)
    expect(totalCost).toBeCloseTo(1)
    expect(rows.every(row => row['agent'] === 'claude')).toBe(true)
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

  it('serves dashboard assets, SPA fallback, and blocks path traversal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'economy-dashboard-static-'))
    roots.push(root)
    const dashboardDir = join(root, 'dist')
    mkdirSync(join(dashboardDir, 'assets'), { recursive: true })
    writeFileSync(join(dashboardDir, 'index.html'), '<html>dashboard shell</html>')
    writeFileSync(join(dashboardDir, 'assets', 'app.js'), 'console.log("asset")')
    writeFileSync(join(root, 'secret.txt'), 'should not leak')

    const fetch = createServerFetch(async request => {
      return new Response(JSON.stringify({ error: new URL(request.url).pathname }), { status: 404 })
    }, dashboardDir)

    let response = await fetch(new Request('http://localhost:3456/'))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('dashboard shell')

    response = await fetch(new Request('http://localhost:3456/assets/app.js'))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('asset')

    response = await fetch(new Request('http://localhost:3456/settings/budgets'))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('dashboard shell')

    response = await fetch(new Request('http://localhost:3456/%2e%2e%2fsecret.txt'))
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('should not leak')

    response = await fetch(new Request('http://localhost:3456/%E0%A4%A'))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('dashboard shell')
  })

  it('delegates non-API routes to the API handler when dashboard assets are missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'economy-missing-dashboard-'))
    roots.push(root)
    const fetch = createServerFetch(async request => {
      return new Response(JSON.stringify({ path: new URL(request.url).pathname }), {
        status: 418,
        headers: { 'Content-Type': 'application/json' },
      })
    }, join(root, 'missing-dashboard'))

    const response = await fetch(new Request('http://localhost:3456/settings/budgets'))

    expect(response.status).toBe(418)
    expect(await response.json()).toEqual({ path: '/settings/budgets' })
  })

  it('startServer returns a stoppable server bound to all interfaces', async () => {
    const root = mkdtempSync(join(tmpdir(), 'economy-start-server-'))
    roots.push(root)
    const server = startServer(0, {
      db,
      dashboardDir: join(root, 'missing-dashboard'),
      log: () => {},
    })

    try {
      expect(server.port).toBeGreaterThan(0)
      expect(server.hostname).toBe('0.0.0.0')
      const response = await fetch(`http://127.0.0.1:${server.port}/health`)
      expect(response.status).toBe(200)
      const payload = await response.json() as Record<string, Record<string, string>>
      expect(payload['data']?.['status']).toBe('ok')
    } finally {
      server.stop(true)
    }
  })

  it('GET /api/machines returns machine list', async () => {
    const { status, data } = await req(handler, '/api/machines')
    expect(status).toBe(200)
    expect(Array.isArray((data as Record<string, unknown>)['data'])).toBe(true)
  })

  it('GET /api/fleet applies period filters to machine rows', async () => {
    upsertSession(db, {
      id: 'fleet-old-spark', agent: 'claude', project_path: '/proj/fleet', project_name: 'fleet',
      started_at: '2000-01-01T00:00:00.000Z', ended_at: null, total_cost_usd: 99, total_tokens: 99, request_count: 9, machine_id: 'spark02',
    })
    upsertSession(db, {
      id: 'fleet-old-apple', agent: 'claude', project_path: '/proj/fleet', project_name: 'fleet',
      started_at: '2000-01-01T00:00:00.000Z', ended_at: null, total_cost_usd: 99, total_tokens: 99, request_count: 9, machine_id: 'apple06',
    })
    upsertRequest(db, {
      id: 'fleet-spark-today', agent: 'claude', session_id: 'fleet-old-spark', model: 'claude-sonnet-4-6',
      input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_create_tokens: 0,
      cost_usd: 0.5, duration_ms: 100, timestamp: NOW, source_request_id: 'fleet-spark-today', machine_id: 'spark02',
    })
    upsertRequest(db, {
      id: 'fleet-apple-old', agent: 'claude', session_id: 'fleet-old-apple', model: 'claude-sonnet-4-6',
      input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_create_tokens: 0,
      cost_usd: 0.5, duration_ms: 100, timestamp: '2000-01-01T00:00:00.000Z', source_request_id: 'fleet-apple-old', machine_id: 'apple06',
    })

    const { data } = await req(handler, '/api/fleet?period=today')
    const fleet = (data as Record<string, unknown>)['data'] as Record<string, unknown>
    const machines = fleet['machines'] as Array<Record<string, unknown>>

    expect(machines.some(machine => machine['machine_id'] === 'spark02')).toBe(true)
    expect(machines.some(machine => machine['machine_id'] === 'apple06')).toBe(false)
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

  it('machine= filters breakdown endpoints', async () => {
    upsertSession(db, {
      id: 'sess-spark-breakdown', agent: 'claude', project_path: '/proj/spark-breakdown', project_name: 'spark-breakdown',
      started_at: NOW, ended_at: null, total_cost_usd: 1, total_tokens: 150, request_count: 1, machine_id: 'spark02',
      account_key: 'claude:spark', account_tool: 'claude', account_name: 'spark', account_source: 'test',
    })
    upsertSession(db, {
      id: 'sess-apple-breakdown', agent: 'codex', project_path: '/proj/apple-breakdown', project_name: 'apple-breakdown',
      started_at: NOW, ended_at: null, total_cost_usd: 2, total_tokens: 150, request_count: 1, machine_id: 'apple03',
      account_key: 'codex:apple', account_tool: 'codex', account_name: 'apple', account_source: 'test',
    })
    upsertRequest(db, {
      id: 'req-spark-breakdown', agent: 'claude', session_id: 'sess-spark-breakdown', model: 'claude-sonnet-4-6',
      input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_create_tokens: 0,
      cost_usd: 1, duration_ms: 100, timestamp: NOW, source_request_id: 'req-spark-breakdown', machine_id: 'spark02',
      account_key: 'claude:spark', account_tool: 'claude', account_name: 'spark', account_source: 'test',
    })
    upsertRequest(db, {
      id: 'req-apple-breakdown', agent: 'codex', session_id: 'sess-apple-breakdown', model: 'gpt-5-codex',
      input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_create_tokens: 0,
      cost_usd: 2, duration_ms: 100, timestamp: NOW, source_request_id: 'req-apple-breakdown', machine_id: 'apple03',
      account_key: 'codex:apple', account_tool: 'codex', account_name: 'apple', account_source: 'test',
    })
    upsertSession(db, {
      id: 'sess-legacy-spark-breakdown', agent: 'claude', project_path: '/proj/legacy-spark-breakdown', project_name: 'legacy-spark-breakdown',
      started_at: NOW, ended_at: null, total_cost_usd: 0, total_tokens: 0, request_count: 0, machine_id: '',
      account_key: 'claude:legacy', account_tool: 'claude', account_name: 'legacy', account_source: 'test',
    })
    upsertRequest(db, {
      id: 'req-legacy-spark-breakdown', agent: 'claude', session_id: 'sess-legacy-spark-breakdown', model: 'claude-sonnet-4-6',
      input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_create_tokens: 0,
      cost_usd: 3, duration_ms: 100, timestamp: NOW, source_request_id: 'req-legacy-spark-breakdown', machine_id: 'spark02',
      account_key: 'claude:legacy', account_tool: 'claude', account_name: 'legacy', account_source: 'test',
    })

    const projects = await req(handler, '/api/projects?period=all&machine=spark02')
    const projectRows = ((projects.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>).map(row => row['project_name'])
    expect(projectRows).toEqual(['legacy-spark-breakdown', 'spark-breakdown'])

    const agents = await req(handler, '/api/breakdown?by=agent&period=all&machine=spark02')
    const agentRows = ((agents.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>).map(row => row['agent'])
    expect(agentRows).toEqual(['claude'])

    const accounts = await req(handler, '/api/accounts?period=all&machine=spark02')
    const accountRows = ((accounts.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>).map(row => row['account_key'])
    expect(accountRows).toEqual(['claude:legacy', 'claude:spark'])

    const daily = await req(handler, '/api/daily?days=14&machine=spark02')
    const dailyCost = ((daily.data as Record<string, unknown>)['data'] as Array<Record<string, unknown>>)
      .reduce((sum, row) => sum + Number(row['cost_usd'] ?? 0), 0)
    expect(dailyCost).toBeCloseTo(4)
  })
})
