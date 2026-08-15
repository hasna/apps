import { describe, expect, test } from 'bun:test'
import { openDatabase, upsertRequest, upsertSubscription, upsertUsageSnapshot } from '../db/database.js'
import { computeSavedUsd, querySavingsSummary } from './savings.js'
import { AGENTS, isAgent } from './agents.js'

const NOW = new Date().toISOString()
const TODAY = NOW.substring(0, 10)

function request(id: string, agent: 'claude' | 'cursor', cost_usd: number, cost_basis: 'metered_api' | 'subscription_included' | 'estimated') {
  return {
    id,
    agent,
    session_id: `${id}-session`,
    model: `${agent}-model`,
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_tokens: 0,
    cache_create_tokens: 0,
    cost_usd,
    cost_basis,
    duration_ms: 1000,
    timestamp: NOW,
    source_request_id: `${id}-source`,
    machine_id: '',
  } as const
}

describe('agents registry', () => {
  test('includes all planned coding agents', () => {
    expect(AGENTS).toContain('opencode')
    expect(AGENTS).toContain('cursor')
    expect(AGENTS).toContain('hermes')
    expect(isAgent('claude')).toBe(true)
    expect(isAgent('unknown')).toBe(false)
  })
})

describe('savings math', () => {
  test('computeSavedUsd never returns negative savings', () => {
    expect(computeSavedUsd(10, 20, 5)).toBe(0)
    expect(computeSavedUsd(100, 20, 10)).toBe(70)
  })

  test('querySavingsSummary returns zeroes for empty db', () => {
    const db = openDatabase(':memory:', true)
    const summary = querySavingsSummary(db, 'month')
    expect(summary.api_equivalent_usd).toBe(0)
    expect(summary.saved_usd).toBe(0)
    db.close()
  })

  test('querySavingsSummary applies subscription fees, included caps, on-demand, and per-agent savings', () => {
    const db = openDatabase(':memory:', true)
    upsertRequest(db, request('cursor-api', 'cursor', 100, 'metered_api'))
    upsertRequest(db, request('cursor-included', 'cursor', 50, 'subscription_included'))
    upsertUsageSnapshot(db, {
      agent: 'cursor',
      date: TODAY,
      metric: 'on_demand_usd',
      value: 10,
      unit: 'usd',
      machine_id: 'test-machine',
    })
    upsertSubscription(db, {
      id: 'cursor-pro',
      agent: 'cursor',
      provider: 'cursor',
      plan: 'pro',
      monthly_fee_usd: 20,
      included_usage_usd: 30,
      billing_cycle_start: null,
      reset_policy: 'monthly',
      active: 1,
      created_at: NOW,
      updated_at: NOW,
    })

    const summary = querySavingsSummary(db, 'month')

    expect(summary.api_equivalent_usd).toBe(150)
    expect(summary.subscription_fee_usd).toBe(20)
    expect(summary.included_consumed_usd).toBe(30)
    expect(summary.on_demand_usd).toBe(10)
    expect(summary.saved_usd).toBe(120)
    expect(summary.by_agent.cursor?.api_equivalent_usd).toBe(150)
    expect(summary.by_agent.cursor?.subscription_fee_usd).toBe(20)
    expect(summary.by_agent.cursor?.included_consumed_usd).toBe(30)
    expect(summary.by_agent.cursor?.on_demand_usd).toBe(10)
    expect(summary.by_agent.cursor?.saved_usd).toBe(120)
    db.close()
  })

  test('agent-filtered savings includes all-agent subscriptions', () => {
    const db = openDatabase(':memory:', true)
    upsertRequest(db, request('claude-api', 'claude', 100, 'metered_api'))
    upsertSubscription(db, {
      id: 'global-plan',
      agent: null,
      provider: 'shared',
      plan: 'team',
      monthly_fee_usd: 20,
      included_usage_usd: 100,
      billing_cycle_start: null,
      reset_policy: 'monthly',
      active: 1,
      created_at: NOW,
      updated_at: NOW,
    })

    const summary = querySavingsSummary(db, 'month', 'claude')

    expect(summary.api_equivalent_usd).toBe(100)
    expect(summary.subscription_fee_usd).toBe(20)
    expect(summary.saved_usd).toBe(80)
    db.close()
  })
})
