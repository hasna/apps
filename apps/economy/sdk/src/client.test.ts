import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { EconomyClient } from './client.js'
import { economyTools } from './schemas.js'

const originalFetch = globalThis.fetch

let calls: Array<{ url: string; init?: RequestInit }>

function mockJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  calls = []
})

afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env['ECONOMY_URL']
})

describe('EconomyClient', () => {
  it('passes search and machine filters to sessions endpoint', async () => {
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init })
      return mockJson({ data: [], meta: {} })
    }) as typeof fetch

    const client = new EconomyClient({ baseUrl: 'http://economy.test', retries: 0 })
    await client.getSessions({ agent: 'gemini', search: 'open-economy', machine: 'spark02', limit: 5 })

    const url = new URL(calls[0]!.url)
    expect(url.origin + url.pathname).toBe('http://economy.test/api/sessions')
    expect(url.searchParams.get('agent')).toBe('gemini')
    expect(url.searchParams.get('machine')).toBe('spark02')
    expect(url.searchParams.get('search')).toBe('open-economy')
    expect(url.searchParams.get('limit')).toBe('5')
  })

  it('uses ECONOMY_URL when constructed from the environment', async () => {
    process.env['ECONOMY_URL'] = 'http://economy.env'
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init })
      return mockJson({ data: [], meta: {} })
    }) as typeof fetch

    const client = EconomyClient.fromEnv()
    await client.getMachines()

    expect(calls[0]!.url).toBe('http://economy.env/api/machines')
  })

  it('maps read helpers to their REST API endpoints', async () => {
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init })
      return mockJson({ data: [], meta: {} })
    }) as typeof fetch

    const client = new EconomyClient({ baseUrl: 'http://economy.test', retries: 0 })
    await client.getTopSessions(3, 'codex')
    await client.getModelBreakdown()
    await client.getProjectBreakdown()
    await client.getBudgets()
    await client.getDaily(14)
    await client.getPricing()
    await client.getGoals()

    expect(calls.map(call => call.url)).toEqual([
      'http://economy.test/api/top?n=3&agent=codex',
      'http://economy.test/api/models',
      'http://economy.test/api/projects',
      'http://economy.test/api/budgets',
      'http://economy.test/api/daily?days=14',
      'http://economy.test/api/pricing',
      'http://economy.test/api/goals',
    ])
  })

  it('encodes session detail and mutation identifiers', async () => {
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init })
      return mockJson({ data: init?.method === 'DELETE' ? { ok: true } : [], meta: {} })
    }) as typeof fetch

    const client = new EconomyClient({ baseUrl: 'http://economy.test', retries: 0 })
    await client.getSessionRequests('session/with spaces')
    const budgetDelete = await client.deleteBudget('budget/with spaces')
    const pricingDelete = await client.deletePricing('openai/gpt 5.5')
    const goalDelete = await client.deleteGoal('goal/with spaces')

    expect(calls.map(call => new URL(call.url).pathname)).toEqual([
      '/api/sessions/session%2Fwith%20spaces/requests',
      '/api/budgets/budget%2Fwith%20spaces',
      '/api/pricing/openai%2Fgpt%205.5',
      '/api/goals/goal%2Fwith%20spaces',
    ])
    expect(calls.slice(1).map(call => call.init?.method)).toEqual(['DELETE', 'DELETE', 'DELETE'])
    expect([budgetDelete.ok, pricingDelete.ok, goalDelete.ok]).toEqual([true, true, true])
  })

  it('sync accepts all supported ingestion sources', async () => {
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init })
      return mockJson({ data: { gemini: { sessions: 1 } }, meta: {} })
    }) as typeof fetch

    const client = new EconomyClient({ baseUrl: 'http://economy.test', retries: 0 })
    await client.sync('gemini')

    expect(calls[0]!.url).toBe('http://economy.test/api/sync')
    expect(calls[0]!.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ sources: 'gemini' })
  })

  it('exposes billing summary and admin sync endpoints', async () => {
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init })
      return mockJson({ data: { total_usd: 12.34, by_provider: { openai: 12.34 } }, meta: {} })
    }) as typeof fetch

    const client = new EconomyClient({ baseUrl: 'http://economy.test', retries: 0 })
    await client.getBilling('month')
    await client.syncBilling({ days: 7, providers: ['openai', 'gemini'] })

    expect(calls[0]!.url).toBe('http://economy.test/api/billing?period=month')
    expect(calls[1]!.url).toBe('http://economy.test/api/billing/sync')
    expect(calls[1]!.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ days: 7, providers: ['openai', 'gemini'] })
  })

  it('exposes budget, pricing, and goal mutation endpoints', async () => {
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init })
      const path = new URL(String(url)).pathname
      const responses: Record<string, unknown> = {
        '/api/budgets': {
          id: 'budget-1',
          project_path: '/workspace/open-economy',
          agent: 'codex',
          period: 'weekly',
          limit_usd: 25,
          alert_at_percent: 70,
          created_at: '2026-05-09T00:00:00.000Z',
          updated_at: '2026-05-09T00:00:00.000Z',
          current_spend_usd: 1,
          percent_used: 4,
          is_over_limit: false,
          is_over_alert: false,
        },
        '/api/pricing': {
          model: 'custom-model',
          input_per_1m: 1,
          output_per_1m: 2,
          cache_read_per_1m: 0,
          cache_write_per_1m: 0,
          cache_write_1h_per_1m: 0,
          cache_storage_per_1m_hour: 4.5,
          updated_at: '2026-05-09T00:00:00.000Z',
        },
        '/api/goals': {
          id: 'goal-1',
          period: 'week',
          project_path: '/workspace/open-economy',
          agent: 'codex',
          limit_usd: 50,
          created_at: '2026-05-09T00:00:00.000Z',
          updated_at: '2026-05-09T00:00:00.000Z',
          current_spend_usd: 1,
          percent_used: 2,
          is_on_track: true,
          is_at_risk: false,
          is_over: false,
        },
      }
      return mockJson({ data: responses[path], meta: {} })
    }) as typeof fetch

    const client = new EconomyClient({ baseUrl: 'http://economy.test', retries: 0 })
    const budget = await client.createBudget({
      project_path: '/workspace/open-economy',
      agent: 'codex',
      period: 'weekly',
      limit_usd: 25,
      alert_at_percent: 70,
    })
    const pricing = await client.createPricing({
      model: 'custom-model',
      input_per_1m: 1,
      output_per_1m: 2,
      cache_storage_per_1m_hour: 4.5,
    })
    const goal = await client.createGoal({
      period: 'week',
      limit_usd: 50,
      project_path: '/workspace/open-economy',
      agent: 'codex',
    })

    expect(calls.map(call => call.url)).toEqual([
      'http://economy.test/api/budgets',
      'http://economy.test/api/pricing',
      'http://economy.test/api/goals',
    ])
    expect(calls.map(call => call.init?.method)).toEqual(['POST', 'POST', 'POST'])
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      project_path: '/workspace/open-economy',
      agent: 'codex',
      period: 'weekly',
      limit_usd: 25,
      alert_at_percent: 70,
    })
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      model: 'custom-model',
      input_per_1m: 1,
      output_per_1m: 2,
      cache_storage_per_1m_hour: 4.5,
    })
    expect(JSON.parse(String(calls[2]!.init?.body))).toEqual({
      period: 'week',
      limit_usd: 50,
      project_path: '/workspace/open-economy',
      agent: 'codex',
    })
    expect(budget).toMatchObject({ id: 'budget-1', percent_used: 4 })
    expect(pricing).toMatchObject({ model: 'custom-model', input_per_1m: 1, cache_storage_per_1m_hour: 4.5, updated_at: expect.any(String) })
    expect(goal).toMatchObject({ id: 'goal-1', is_on_track: true, percent_used: 2 })
  })

  it('does not retry client errors', async () => {
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response('bad request', { status: 400 })
    }) as typeof fetch

    const client = new EconomyClient({ baseUrl: 'http://economy.test', retries: 3, retryDelayMs: 1 })
    await expect(client.getSummary('today')).rejects.toThrow('HTTP 400')
    expect(calls.length).toBe(1)
  })

  it('retries server errors and returns the later successful response', async () => {
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init })
      if (calls.length === 1) return new Response('temporary failure', { status: 503 })
      return mockJson({ data: { total_usd: 1, requests: 2, tokens: 3, sessions: 4, period: 'today' }, meta: {} })
    }) as typeof fetch

    const client = new EconomyClient({ baseUrl: 'http://economy.test', retries: 2, retryDelayMs: 1 })
    const summary = await client.getSummary('today', 'spark02')

    expect(summary.total_usd).toBe(1)
    expect(calls.length).toBe(2)
    expect(calls[0]!.url).toBe('http://economy.test/api/summary?period=today&machine=spark02')
    expect(calls[1]!.url).toBe('http://economy.test/api/summary?period=today&machine=spark02')
  })
})

describe('economyTools schemas', () => {
  it('advertise the SDK read surface and supported agent/source filters', () => {
    const sessions = economyTools.find(t => t.name === 'economy_get_sessions')!
    const top = economyTools.find(t => t.name === 'economy_get_top_sessions')!
    const sync = economyTools.find(t => t.name === 'economy_sync')!
    const pricing = economyTools.find(t => t.name === 'economy_get_pricing')!
    const setPricing = economyTools.find(t => t.name === 'economy_set_pricing')!
    const removePricing = economyTools.find(t => t.name === 'economy_remove_pricing')!
    const setBudget = economyTools.find(t => t.name === 'economy_set_budget')!
    const removeBudget = economyTools.find(t => t.name === 'economy_remove_budget')!
    const detail = economyTools.find(t => t.name === 'economy_get_session_detail')!
    const daily = economyTools.find(t => t.name === 'economy_get_daily')!
    const goals = economyTools.find(t => t.name === 'economy_get_goals')!
    const setGoal = economyTools.find(t => t.name === 'economy_set_goal')!
    const removeGoal = economyTools.find(t => t.name === 'economy_remove_goal')!
    const machines = economyTools.find(t => t.name === 'economy_list_machines')!

    expect(sessions.parameters.properties.agent.enum).toContain('gemini')
    expect(sessions.parameters.properties.agent.enum).toContain('takumi')
    expect(sessions.parameters.properties.machine.type).toBe('string')
    expect(sessions.parameters.properties.search.type).toBe('string')
    expect(top.parameters.properties.agent.enum).toContain('gemini')
    expect(top.parameters.properties.agent.enum).toContain('takumi')
    expect(sync.parameters.properties.sources.enum).toEqual(['all', 'claude', 'takumi', 'codex', 'gemini'])
    expect(pricing.description).toContain('context-cache storage')
    expect(setPricing.parameters.required).toEqual(['model', 'input_per_1m', 'output_per_1m'])
    expect(removePricing.parameters.required).toEqual(['model'])
    expect(setBudget.parameters.properties.period.enum).toEqual(['daily', 'weekly', 'monthly'])
    expect(setBudget.parameters.required).toEqual(['period', 'limit_usd'])
    expect(removeBudget.parameters.required).toEqual(['id'])
    expect(detail.parameters.required).toEqual(['session_id'])
    expect(daily.parameters.properties.days.type).toBe('number')
    expect(goals.parameters.properties).toEqual({})
    expect(setGoal.parameters.properties.period.enum).toEqual(['day', 'week', 'month', 'year'])
    expect(setGoal.parameters.required).toEqual(['period', 'limit_usd'])
    expect(removeGoal.parameters.required).toEqual(['id'])
    expect(machines.parameters.properties).toEqual({})
  })
})
