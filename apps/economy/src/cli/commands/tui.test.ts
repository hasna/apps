import { describe, expect, test } from 'bun:test'
import { buildStatusLine, buildWaybarJson, type StatusData } from './tui.js'

function sampleData(overrides: Partial<StatusData> = {}): StatusData {
  return {
    today: { total_usd: 1.5, requests: 0, tokens: 0, sessions: 0, period: 'today' },
    week: { total_usd: 10, requests: 0, tokens: 0, sessions: 0, period: 'week' },
    month: { total_usd: 20, requests: 0, tokens: 0, sessions: 0, period: 'month' },
    savings: {
      period: 'month',
      api_equivalent_usd: 0,
      subscription_fee_usd: 0,
      included_consumed_usd: 0,
      on_demand_usd: 0,
      saved_usd: 3,
      by_agent: {},
    },
    machineCount: 3,
    topAgent: 'claude',
    quota: null,
    transport: 'local',
    ...overrides,
  }
}

describe('status line', () => {
  test('buildStatusLine includes spend and fleet fields', () => {
    const line = buildStatusLine(sampleData())
    expect(line).toContain('today')
    expect(line).toContain('week')
    expect(line).toContain('machines')
  })

  test('buildStatusLine reports self_hosted transport', () => {
    const line = buildStatusLine(sampleData({ transport: 'cloud-http' }))
    expect(line).toContain('self_hosted')
  })

  test('buildWaybarJson surfaces savings and today spend', () => {
    const json = buildWaybarJson(sampleData())
    expect(json['savings_usd']).toBe(3)
    expect(json['text']).toBe('$1.50')
  })
})
