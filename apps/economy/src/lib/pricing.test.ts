import { describe, it, expect } from 'bun:test'
import { normalizeModelName, getPricing, computeCost, DEFAULT_PRICING } from './pricing.js'

describe('normalizeModelName', () => {
  it('strips 8-digit date suffix', () => {
    expect(normalizeModelName('claude-sonnet-4-6-20251101')).toBe('claude-sonnet-4-6')
  })

  it('strips ISO date suffix', () => {
    expect(normalizeModelName('claude-opus-4-6-2025-11-01')).toBe('claude-opus-4-6')
  })

  it('lowercases the model name', () => {
    expect(normalizeModelName('Claude-Sonnet-4-6')).toBe('claude-sonnet-4-6')
  })

  it('leaves clean names unchanged', () => {
    expect(normalizeModelName('claude-haiku-4-5')).toBe('claude-haiku-4-5')
  })
})

describe('getPricing', () => {
  it('returns pricing for all known Claude models', () => {
    const claudeModels = Object.keys(DEFAULT_PRICING).filter(k => k.startsWith('claude'))
    for (const model of claudeModels) {
      expect(getPricing(model)).not.toBeNull()
    }
  })

  it('returns pricing for all known Codex/OpenAI models', () => {
    const openaiModels = Object.keys(DEFAULT_PRICING).filter(k => k.startsWith('gpt') || k.startsWith('o'))
    for (const model of openaiModels) {
      expect(getPricing(model)).not.toBeNull()
    }
  })

  it('returns null for unknown models', () => {
    expect(getPricing('unknown-model-xyz')).toBeNull()
  })

  it('handles model names with date suffixes', () => {
    expect(getPricing('claude-sonnet-4-6-20251101')).not.toBeNull()
  })

  it('matches prefix for versioned models', () => {
    const p = getPricing('claude-opus-4-6-extra-suffix')
    expect(p).not.toBeNull()
  })

  it('returned pricing has all required fields', () => {
    const p = getPricing('claude-sonnet-4-6')
    expect(p).not.toBeNull()
    expect(typeof p!.inputPer1M).toBe('number')
    expect(typeof p!.outputPer1M).toBe('number')
    expect(typeof p!.cacheReadPer1M).toBe('number')
    expect(typeof p!.cacheWritePer1M).toBe('number')
  })
})

describe('computeCost', () => {
  it('computes cost for input + output tokens', () => {
    // claude-sonnet-4-6: $3/1M input, $15/1M output
    const cost = computeCost('claude-sonnet-4-6', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(18.0)
  })

  it('includes cache read tokens', () => {
    // cache read = $0.30/1M
    const cost = computeCost('claude-sonnet-4-6', 0, 0, 1_000_000, 0)
    expect(cost).toBeCloseTo(0.30)
  })

  it('includes cache write tokens', () => {
    // cache write = $3.75/1M
    const cost = computeCost('claude-sonnet-4-6', 0, 0, 0, 1_000_000)
    expect(cost).toBeCloseTo(3.75)
  })

  it('returns 0 for unknown model', () => {
    expect(computeCost('unknown-xyz', 100_000, 50_000)).toBe(0)
  })

  it('returns 0 for zero tokens', () => {
    expect(computeCost('claude-sonnet-4-6', 0, 0)).toBe(0)
  })

  it('computes small token amounts correctly', () => {
    // 1000 input tokens at $3/1M = $0.000003
    const cost = computeCost('claude-sonnet-4-6', 1000, 0)
    expect(cost).toBeCloseTo(0.000003)
  })
})
