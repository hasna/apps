import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type { Database } from '../db/database.js'
import type { Budget, EconomyRequest, EconomySession } from '../types/index.js'

const originalFetch = globalThis.fetch
const originalHome = process.env['HOME']
const root = mkdtempSync(join(tmpdir(), 'economy-webhooks-test-'))

let checkAndFireWebhooks: (db: Database) => Promise<void>
let getIngestState: (db: Database, source: string, key: string) => string | null
let openDatabase: (dbPath?: string, skipSeed?: boolean) => Database
let saveConfig: (config: {
  port: number
  'default-period': string
  'auto-sync': boolean
  'sync-interval': number
  'alert-thresholds': number[]
  'webhook-url': string | null
}) => void
let upsertBudget: (db: Database, budget: Budget) => void
let upsertRequest: (db: Database, req: EconomyRequest) => void
let upsertSession: (db: Database, session: EconomySession) => void

const now = new Date().toISOString()

function budget(): Budget {
  return {
    id: 'budget-1',
    project_path: null,
    agent: null,
    period: 'monthly',
    limit_usd: 1,
    alert_at_percent: 50,
    created_at: now,
    updated_at: now,
  }
}

function seedSpend(db: Database, costUsd: number, id = 'request-1'): void {
  upsertSession(db, {
    id: 'session-1',
    agent: 'claude',
    project_path: '/tmp/project',
    project_name: 'project',
    started_at: now,
    ended_at: null,
    total_cost_usd: costUsd,
    total_tokens: 1,
    request_count: 1,
    machine_id: '',
  })
  upsertRequest(db, {
    id,
    agent: 'claude',
    session_id: 'session-1',
    model: 'claude-sonnet-4-6',
    input_tokens: 1,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_create_tokens: 0,
    cost_usd: costUsd,
    duration_ms: 1,
    timestamp: now,
    source_request_id: id,
    machine_id: '',
  })
}

function resetConfig(): void {
  saveConfig({
    port: 3456,
    'default-period': 'today',
    'auto-sync': true,
    'sync-interval': 30,
    'alert-thresholds': [5, 10, 25, 50, 100],
    'webhook-url': 'https://hooks.example/economy',
  })
}

beforeAll(async () => {
  process.env['HOME'] = root
  const database = await import('../db/database.js')
  const config = await import('./config.js')
  const webhooks = await import('./webhooks.js')
  checkAndFireWebhooks = webhooks.checkAndFireWebhooks
  getIngestState = database.getIngestState
  openDatabase = database.openDatabase
  saveConfig = config.saveConfig
  upsertBudget = database.upsertBudget
  upsertRequest = database.upsertRequest
  upsertSession = database.upsertSession
})

beforeEach(() => {
  resetConfig()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

afterAll(() => {
  if (originalHome === undefined) delete process.env['HOME']
  else process.env['HOME'] = originalHome
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('checkAndFireWebhooks', () => {
  it('fires each budget alert once per percent bucket', async () => {
    const calls: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response(null, { status: 204 })
    }) as typeof fetch

    const db = openDatabase(':memory:', true)
    upsertBudget(db, budget())
    seedSpend(db, 0.75)

    await checkAndFireWebhooks(db)
    await checkAndFireWebhooks(db)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      event: 'budget_alert',
      budget_id: 'budget-1',
      project: 'global',
      period: 'monthly',
      spend: 0.75,
      limit: 1,
      percent: 75,
    })
    expect(getIngestState(db, 'webhook', 'webhook-budget-budget-1-monthly')).toBe('70')

    seedSpend(db, 0.1, 'request-2')
    await checkAndFireWebhooks(db)

    expect(calls).toHaveLength(2)
    expect(calls[1]?.['spend']).toBeCloseTo(0.85)
    expect(getIngestState(db, 'webhook', 'webhook-budget-budget-1-monthly')).toBe('80')
  })

  it('does not mark failed webhook deliveries as fired', async () => {
    let shouldFail = true
    let attempts = 0
    globalThis.fetch = (async () => {
      attempts += 1
      if (shouldFail) return new Response(null, { status: 500 })
      return new Response(null, { status: 204 })
    }) as typeof fetch

    const db = openDatabase(':memory:', true)
    upsertBudget(db, budget())
    seedSpend(db, 0.75)

    await checkAndFireWebhooks(db)

    expect(attempts).toBe(1)
    expect(getIngestState(db, 'webhook', 'webhook-budget-budget-1-monthly')).toBeNull()

    shouldFail = false
    await checkAndFireWebhooks(db)

    expect(attempts).toBe(2)
    expect(getIngestState(db, 'webhook', 'webhook-budget-budget-1-monthly')).toBe('70')
  })

  it('retries when webhook delivery throws before receiving a response', async () => {
    let shouldThrow = true
    let attempts = 0
    globalThis.fetch = (async () => {
      attempts += 1
      if (shouldThrow) throw new Error('network unavailable')
      return new Response(null, { status: 204 })
    }) as typeof fetch

    const db = openDatabase(':memory:', true)
    upsertBudget(db, budget())
    seedSpend(db, 0.75)

    await checkAndFireWebhooks(db)

    expect(attempts).toBe(1)
    expect(getIngestState(db, 'webhook', 'webhook-budget-budget-1-monthly')).toBeNull()

    shouldThrow = false
    await checkAndFireWebhooks(db)

    expect(attempts).toBe(2)
    expect(getIngestState(db, 'webhook', 'webhook-budget-budget-1-monthly')).toBe('70')
  })

  it('does not call fetch when webhook-url is not configured', async () => {
    let attempts = 0
    globalThis.fetch = (async () => {
      attempts += 1
      return new Response(null, { status: 204 })
    }) as typeof fetch
    saveConfig({
      port: 3456,
      'default-period': 'today',
      'auto-sync': true,
      'sync-interval': 30,
      'alert-thresholds': [5, 10, 25, 50, 100],
      'webhook-url': null,
    })

    const db = openDatabase(':memory:', true)
    upsertBudget(db, budget())
    seedSpend(db, 0.75)

    await checkAndFireWebhooks(db)

    expect(attempts).toBe(0)
    expect(getIngestState(db, 'webhook', 'webhook-budget-budget-1-monthly')).toBeNull()
  })

  it('fires a cost spike webhook once per day', async () => {
    const calls: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response(null, { status: 204 })
    }) as typeof fetch

    const db = openDatabase(':memory:', true)
    const baseDate = new Date()
    for (let i = 8; i >= 1; i--) {
      const d = new Date(baseDate)
      d.setDate(d.getDate() - (i - 1))
      const date = d.toISOString()
      const cost = i === 1 ? 20 : 1
      seedSpend(db, cost, `request-${i}`)
      db.prepare(`UPDATE requests SET timestamp = ? WHERE id = ?`).run(date, `request-${i}`)
    }

    await checkAndFireWebhooks(db)
    await checkAndFireWebhooks(db)

    const spikeCalls = calls.filter((c) => c['event'] === 'cost_spike')
    expect(spikeCalls).toHaveLength(1)
    expect(spikeCalls[0]?.['cost_usd']).toBe(20)
    expect(getIngestState(db, 'webhook', `webhook-spike-${baseDate.toISOString().substring(0, 10)}`)).toBe('1')
  })
})
