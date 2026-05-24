import { describe, expect, test } from 'bun:test'
import { openDatabase, upsertRequest, upsertSession, upsertBillingDaily } from '../db/database.js'
import { queryBillingDiff } from './billing-diff.js'

describe('queryBillingDiff', () => {
  test('computes delta between telemetry and billing', () => {
    const db = openDatabase(':memory:', true)
    const now = new Date().toISOString()
    upsertSession(db, {
      id: 's1',
      agent: 'claude',
      project_path: '/tmp',
      project_name: 'tmp',
      started_at: now,
      ended_at: null,
      total_cost_usd: 10,
      total_tokens: 100,
      request_count: 1,
      machine_id: 'local',
    })
    upsertRequest(db, {
      id: 'r1',
      agent: 'claude',
      session_id: 's1',
      model: 'claude-sonnet-4-6',
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 0,
      cache_create_tokens: 0,
      cost_usd: 10,
      duration_ms: 1,
      timestamp: now,
      source_request_id: 'r1',
      machine_id: 'local',
    })
    upsertBillingDaily(db, {
      date: now.substring(0, 10),
      provider: 'anthropic',
      description: 'api',
      cost_usd: 8,
      updated_at: now,
    })

    const diff = queryBillingDiff(db, 'month')
    expect(diff.estimated_usd).toBeCloseTo(10)
    expect(diff.actual_usd).toBeCloseTo(8)
    expect(diff.delta_usd).toBeCloseTo(2)
    expect(diff.by_agent[0]?.agent).toBe('claude')
  })
})
