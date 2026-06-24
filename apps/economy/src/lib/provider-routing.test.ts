import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDatabase, upsertRequest, upsertSubscription } from '../db/database.js'
import { buildProviderReadiness } from './provider-routing.js'

const roots: string[] = []
const ORIGINAL_HOME = process.env['HOME']
const ORIGINAL_CURSOR = process.env['CURSOR_SESSION_TOKEN']
const ORIGINAL_GEMINI_KEY = process.env['GEMINI_API_KEY']

function tempHome(): string {
  const root = join(tmpdir(), `economy-provider-routing-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  roots.push(root)
  mkdirSync(root, { recursive: true })
  return root
}

function touchDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

afterEach(() => {
  if (ORIGINAL_HOME === undefined) delete process.env['HOME']
  else process.env['HOME'] = ORIGINAL_HOME
  if (ORIGINAL_CURSOR === undefined) delete process.env['CURSOR_SESSION_TOKEN']
  else process.env['CURSOR_SESSION_TOKEN'] = ORIGINAL_CURSOR
  if (ORIGINAL_GEMINI_KEY === undefined) delete process.env['GEMINI_API_KEY']
  else process.env['GEMINI_API_KEY'] = ORIGINAL_GEMINI_KEY
  for (const root of roots.splice(0)) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})

describe('buildProviderReadiness', () => {
  test('flags provider health and prefers subscription-backed routing', () => {
    const home = tempHome()
    process.env['HOME'] = home
    delete process.env['CURSOR_SESSION_TOKEN']
    delete process.env['GEMINI_API_KEY']
    touchDir(join(home, '.codewith'))
    touchDir(join(home, '.codex'))
    touchDir(join(home, '.claude', 'projects'))
    touchDir(join(home, '.gemini', 'tmp'))
    touchDir(join(home, '.local', 'share', 'opencode', 'storage', 'message'))

    const db = openDatabase(':memory:', false)
    const now = new Date().toISOString()
    upsertSubscription(db, {
      id: 'sub-codewith',
      agent: null,
      provider: 'codewith',
      plan: 'team',
      monthly_fee_usd: 200,
      included_usage_usd: 10000,
      billing_cycle_start: null,
      reset_policy: 'monthly',
      active: 1,
      created_at: now,
      updated_at: now,
    })
    upsertSubscription(db, {
      id: 'sub-codex',
      agent: 'codex',
      provider: 'codex',
      plan: 'chatgpt-pro',
      monthly_fee_usd: 200,
      included_usage_usd: 5000,
      billing_cycle_start: null,
      reset_policy: 'monthly',
      active: 1,
      created_at: now,
      updated_at: now,
    })
    upsertRequest(db, {
      id: 'zero-cost-token-row',
      agent: 'gemini',
      session_id: 's1',
      model: 'unpriced-model',
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_create_tokens: 0,
      cache_create_1h_tokens: 1000,
      cost_usd: 0,
      duration_ms: 1,
      timestamp: now,
      source_request_id: 'zero-cost-token-row',
    })

    const readiness = buildProviderReadiness(db)

    expect(readiness.flags).toContain('missing CURSOR_SESSION_TOKEN')
    expect(readiness.flags).toContain('zero-cost token rows: 1')
    expect(readiness.providers.find(p => p.provider === 'cursor')?.available).toBe(false)
    expect(readiness.providers.find(p => p.provider === 'cursor')?.flags).toContain('missing CURSOR_SESSION_TOKEN')
    expect(readiness.providers.find(p => p.provider === 'pi')).toBeUndefined()
    expect(readiness.routing.preferred.slice(0, 3)).toEqual(['codewith', 'codex', 'claude'])
    expect(readiness.routing.avoid).toContain('cursor')
    expect(readiness.routing.third_party_candidates).toEqual([])
    expect(readiness.routing.recommendation).toContain('Prefer subscription-backed Codewith/Codex/Claude')
  })

  test('allows third-party candidates only with key health and material pricing savings', () => {
    const home = tempHome()
    process.env['HOME'] = home
    process.env['GEMINI_API_KEY'] = 'test-key'
    touchDir(join(home, '.codewith'))
    touchDir(join(home, '.codex'))
    touchDir(join(home, '.claude', 'projects'))
    touchDir(join(home, '.gemini', 'tmp'))

    const db = openDatabase(':memory:', false)
    const readiness = buildProviderReadiness(db)

    expect(readiness.providers.find(p => p.provider === 'gemini')?.key_health).toBe('ok')
    expect(readiness.routing.third_party_candidates).toContain('gemini')
  })
})
