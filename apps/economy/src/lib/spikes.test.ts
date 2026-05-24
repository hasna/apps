import { describe, expect, test } from 'bun:test'
import { detectCostSpikes } from './spikes.js'

describe('detectCostSpikes', () => {
  test('flags days above 2x rolling average', () => {
    const daily = [
      { date: '2026-05-01', cost_usd: 1 },
      { date: '2026-05-02', cost_usd: 1 },
      { date: '2026-05-03', cost_usd: 1 },
      { date: '2026-05-04', cost_usd: 1 },
      { date: '2026-05-05', cost_usd: 1 },
      { date: '2026-05-06', cost_usd: 1 },
      { date: '2026-05-07', cost_usd: 1 },
      { date: '2026-05-08', cost_usd: 5 },
    ]
    const spikes = detectCostSpikes(daily)
    expect(spikes).toHaveLength(1)
    expect(spikes[0]?.date).toBe('2026-05-08')
    expect(spikes[0]?.ratio).toBeGreaterThan(2)
  })

  test('returns empty when history is too short', () => {
    expect(detectCostSpikes([{ date: '2026-05-01', cost_usd: 10 }])).toHaveLength(0)
  })
})
