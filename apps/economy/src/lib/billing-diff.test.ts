import { describe, expect, test } from 'bun:test'
import { openDatabase, upsertRequest, upsertSession, upsertBillingDaily } from '../db/database.js'
import { queryBillingDiff, billingDriftCheck, billingDeltaPct } from './billing-diff.js'
import type { SqliteAdapter } from '../db/sqlite-adapter.js'

/** A db with `estimatedUsd` of telemetry and, optionally, provider billing rows. */
function seed(estimatedUsd: number, billingUsd?: number[]): SqliteAdapter {
  const db = openDatabase(':memory:', true)
  const now = new Date().toISOString()
  upsertSession(db, {
    id: 's1', agent: 'claude', project_path: '/tmp', project_name: 'tmp',
    started_at: now, ended_at: null, total_cost_usd: estimatedUsd,
    total_tokens: 100, request_count: 1, machine_id: 'local',
  })
  upsertRequest(db, {
    id: 'r1', agent: 'claude', session_id: 's1', model: 'claude-sonnet-4-6',
    input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_create_tokens: 0,
    cost_usd: estimatedUsd, duration_ms: 1, timestamp: now, source_request_id: 'r1',
    machine_id: 'local',
  })
  for (const [i, cost] of (billingUsd ?? []).entries()) {
    upsertBillingDaily(db, {
      date: now.substring(0, 10), provider: `provider-${i}`,
      description: 'api', cost_usd: cost, updated_at: now,
    })
  }
  return db
}

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

describe('billingDeltaPct', () => {
  test('returns null — never 0 — when there is no actual to divide by', () => {
    expect(billingDeltaPct(500, 0)).toBeNull()
    expect(billingDeltaPct(0, 0)).toBeNull()
    expect(billingDeltaPct(0, -1)).toBeNull()
  })

  test('measures real drift in both directions', () => {
    expect(billingDeltaPct(10, 10)).toBeCloseTo(0)
    expect(billingDeltaPct(20, 10)).toBeCloseTo(100)
    expect(billingDeltaPct(5, 10)).toBeCloseTo(-50)
  })
})

describe('billing drift comparability', () => {
  test('an EMPTY billing table is not zero drift — it is UNKNOWN, and doctor must not pass it', () => {
    const diff = queryBillingDiff(seed(500), 'month')
    expect(diff.actual_usd).toBe(0)
    expect({ comparable: diff.comparable, reason: diff.incomparable_reason })
      .toEqual({ comparable: false, reason: 'no_billing_records' })

    const check = billingDriftCheck(diff)
    expect(check.ok).toBe(false)
    expect(check.msg).toContain('UNKNOWN')
    expect(check.msg).toContain('no provider billing records')
    // The old lie must not survive anywhere in the rendered line.
    expect(check.msg).not.toContain('0.0%')
  })

  test('billing rows that exist but total zero say SO, and are a different reason', () => {
    const diff = queryBillingDiff(seed(500, [0, 0]), 'month')
    expect({ comparable: diff.comparable, reason: diff.incomparable_reason })
      .toEqual({ comparable: false, reason: 'zero_actual_billing' })

    const check = billingDriftCheck(diff)
    expect(check.ok).toBe(false)
    expect(check.msg).toContain('total $0.00')
  })

  test('both sides zero is still UNKNOWN — never a green tick', () => {
    const diff = queryBillingDiff(seed(0), 'month')
    expect({ estimated: diff.estimated_usd, actual: diff.actual_usd }).toEqual({ estimated: 0, actual: 0 })
    expect(diff.comparable).toBe(false)
    expect(billingDriftCheck(diff).ok).toBe(false)
  })

  // THE CONTROL: a fix proven only on the broken case can silently break the healthy path.
  test('a POPULATED billing table that agrees still reports healthy 0.0%', () => {
    const diff = queryBillingDiff(seed(10, [10]), 'month')
    expect({ comparable: diff.comparable, reason: diff.incomparable_reason })
      .toEqual({ comparable: true, reason: null })
    expect(diff.delta_pct).toBeCloseTo(0)
    expect(diff.is_alert).toBe(false)

    const check = billingDriftCheck(diff)
    expect(check.ok).toBe(true)
    expect(check.msg).toBe('billing drift month: 0.0%')
  })

  test('a POPULATED billing table that disagrees beyond threshold still FAILS', () => {
    const diff = queryBillingDiff(seed(20, [10]), 'month')
    expect(diff.comparable).toBe(true)
    expect(diff.delta_pct).toBeCloseTo(100)
    expect(diff.is_alert).toBe(true)
    expect(billingDriftCheck(diff).ok).toBe(false)
  })
})
