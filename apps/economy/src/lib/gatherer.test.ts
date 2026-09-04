import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  openDatabase,
  upsertBudget,
  upsertGoal,
  upsertModelPricing,
  upsertRequest,
  upsertSession,
} from '../db/database.js'
import { resetEconomyCloudStorageCache } from './cloud-storage.js'
import { gatherTrainingData } from './gatherer.js'
import type { EconomyRequest, EconomySession } from '../types/index.js'

const NOW = new Date().toISOString()

let root: string
let originalDbPath: string | undefined
let originalHome: string | undefined

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

beforeEach(() => {
  root = join(tmpdir(), `economy-gatherer-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  originalDbPath = process.env['HASNA_ECONOMY_DB_PATH']
  originalHome = process.env['HOME']
  // Storage-mode variables are retired. The contracts client selects the http
  // transport from the API URL/KEY pair alone — from the environment and, when
  // the environment is silent, from the fleet app-config files under HOME — so
  // a local test clears both tiers (empty HOME kills the disk tier) and sets
  // HASNA_ECONOMY_LOCAL, the explicit opt-in that makes a no-API-env run a
  // legal local-mode run (without it the storage seam fails closed — see
  // src/lib/cloud-storage.ts).
  delete process.env['HASNA_ECONOMY_API_URL']
  delete process.env['HASNA_ECONOMY_API_KEY']
  process.env['HASNA_ECONOMY_LOCAL'] = '1'
  process.env['ECONOMY_LOCAL'] = '1'
  process.env['HOME'] = ''
  process.env['HASNA_ECONOMY_DB_PATH'] = join(root, 'economy.db')
  resetEconomyCloudStorageCache()
})

afterEach(() => {
  restoreEnv('HASNA_ECONOMY_DB_PATH', originalDbPath)
  restoreEnv('HOME', originalHome)
  delete process.env['HASNA_ECONOMY_LOCAL']
  delete process.env['ECONOMY_LOCAL']
  resetEconomyCloudStorageCache()
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

function sampleSession(overrides: Partial<EconomySession> = {}): EconomySession {
  return {
    id: 'session-1',
    agent: 'codex',
    project_path: '/workspace/hasna/opensource/economy',
    project_name: 'economy',
    started_at: NOW,
    ended_at: null,
    total_cost_usd: 1.25,
    total_tokens: 15_000,
    request_count: 2,
    machine_id: 'spark02',
    ...overrides,
  }
}

function sampleRequest(overrides: Partial<EconomyRequest> = {}): EconomyRequest {
  return {
    id: 'request-1',
    agent: 'codex',
    session_id: 'session-1',
    model: 'gpt-5.5',
    input_tokens: 10_000,
    output_tokens: 3_000,
    cache_read_tokens: 2_000,
    cache_create_tokens: 0,
    cost_usd: 1.25,
    duration_ms: 1500,
    timestamp: NOW,
    source_request_id: 'source-request-1',
    machine_id: 'spark02',
    ...overrides,
  }
}

function userPrompts(result: Awaited<ReturnType<typeof gatherTrainingData>>): string[] {
  return result.examples.map(example => example.messages[1]?.content ?? '')
}

describe('gatherTrainingData', () => {
  it('returns no examples for an empty economy database', async () => {
    const db = openDatabase(undefined, true)
    db.close()

    const result = await gatherTrainingData()

    expect(result).toEqual({ source: 'economy', examples: [], count: 0 })
  })

  it('builds training examples from real cost, budget, and goal data', async () => {
    const db = openDatabase(undefined, true)
    upsertSession(db, sampleSession())
    upsertRequest(db, sampleRequest())
    upsertModelPricing(db, {
      model: 'gpt-5.5',
      input_per_1m: 1.25,
      output_per_1m: 10,
      cache_read_per_1m: 0.125,
      cache_write_per_1m: 1.25,
      updated_at: NOW,
    })
    upsertBudget(db, {
      id: 'budget-1',
      project_path: '/workspace/hasna/opensource/economy',
      agent: 'codex',
      period: 'monthly',
      limit_usd: 5,
      alert_at_percent: 80,
      created_at: NOW,
      updated_at: NOW,
    })
    upsertGoal(db, {
      id: 'goal-1',
      project_path: '/workspace/hasna/opensource/economy',
      agent: 'codex',
      period: 'month',
      limit_usd: 3,
      created_at: NOW,
      updated_at: NOW,
    })
    db.close()

    const result = await gatherTrainingData({ limit: 50 })
    const prompts = userPrompts(result)

    expect(result.source).toBe('economy')
    expect(result.count).toBe(result.examples.length)
    expect(prompts).toContain('What did I spend on AI today?')
    expect(prompts).toContain('Which AI models have I spent the most on?')
    expect(prompts).toContain('Which projects are costing the most?')
    expect(prompts).toContain('How am I tracking against my AI spending budgets?')
    expect(prompts).toContain('Am I on track with my AI cost reduction goals?')
    expect(result.examples.some(example => example.messages[2]?.content.includes('$1.2500'))).toBe(true)
  })

  it('honors the training example limit after gathering', async () => {
    const db = openDatabase(undefined, true)
    upsertSession(db, sampleSession())
    upsertRequest(db, sampleRequest())
    db.close()

    const result = await gatherTrainingData({ limit: 3 })

    expect(result.count).toBe(3)
    expect(result.examples).toHaveLength(3)
  })
})
