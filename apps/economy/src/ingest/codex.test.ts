import { describe, it, expect } from 'bun:test'
import { openDatabase } from '../db/database.js'
import { computeCost } from '../lib/pricing.js'

describe('ingestCodex (unit)', () => {
  it('computeCost with gpt-5.3-codex returns non-zero', () => {
    const cost = computeCost('gpt-5.3-codex', 100_000, 40_000)
    expect(cost).toBeGreaterThan(0)
    // $1.75/1M input + $14/1M output
    // = 100k * 1.75/1M + 40k * 14/1M = 0.175 + 0.56 = 0.735
    expect(cost).toBeCloseTo(0.735)
  })

  it('60/40 token split estimate produces expected cost', () => {
    const tokens = 1000
    const input = Math.floor(tokens * 0.6)
    const output = tokens - input
    expect(input).toBe(600)
    expect(output).toBe(400)
    const cost = computeCost('gpt-5.3-codex', input, output)
    expect(cost).toBeGreaterThan(0)
  })

  it('ingestCodex skips gracefully when codex db not found', async () => {
    const db = openDatabase(':memory:', true)
    const { ingestCodex } = await import('./codex.js')
    // ~/.codex/state_5.sqlite may or may not exist
    // Either way it should not throw
    const result = await ingestCodex(db, false)
    expect(typeof result.sessions).toBe('number')
  })

  it('session objects are inserted with correct agent field', () => {
    const db = openDatabase(':memory:', true)
    const { upsertSession } = require('../db/database.js') as typeof import('../db/database.js')
    const now = new Date().toISOString()
    upsertSession(db, {
      id: 'codex-thread-1',
      agent: 'codex',
      project_path: '/home/user/project',
      project_name: 'project',
      started_at: now,
      ended_at: now,
      total_cost_usd: 1.234,
      total_tokens: 5000,
      request_count: 1,
    })
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get('codex-thread-1') as { agent: string; total_cost_usd: number }
    expect(row.agent).toBe('codex')
    expect(row.total_cost_usd).toBeCloseTo(1.234)
  })
})
