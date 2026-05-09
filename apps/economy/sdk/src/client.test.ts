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

  it('does not retry client errors', async () => {
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response('bad request', { status: 400 })
    }) as typeof fetch

    const client = new EconomyClient({ baseUrl: 'http://economy.test', retries: 3, retryDelayMs: 1 })
    await expect(client.getSummary('today')).rejects.toThrow('HTTP 400')
    expect(calls.length).toBe(1)
  })
})

describe('economyTools schemas', () => {
  it('advertise Gemini and Takumi wherever agent/source filters are available', () => {
    const sessions = economyTools.find(t => t.name === 'economy_get_sessions')!
    const top = economyTools.find(t => t.name === 'economy_get_top_sessions')!
    const sync = economyTools.find(t => t.name === 'economy_sync')!

    expect(sessions.parameters.properties.agent.enum).toContain('gemini')
    expect(sessions.parameters.properties.agent.enum).toContain('takumi')
    expect(top.parameters.properties.agent.enum).toContain('gemini')
    expect(top.parameters.properties.agent.enum).toContain('takumi')
    expect(sync.parameters.properties.sources.enum).toEqual(['all', 'claude', 'takumi', 'codex', 'gemini'])
  })
})
