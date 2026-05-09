import { describe, it, expect } from 'bun:test'
import { normalizeModelName, getPricing, computeCost, DEFAULT_PRICING, ensurePricingSeeded } from './pricing.js'
import { openDatabase, upsertModelPricing, getModelPricing } from '../db/database.js'

describe('normalizeModelName', () => {
  it('strips date suffixes, provider prefixes, and lowercases', () => {
    expect(normalizeModelName('claude-sonnet-4-6-20251101')).toBe('claude-sonnet-4-6')
    expect(normalizeModelName('claude-opus-4-6-2025-11-01')).toBe('claude-opus-4-6')
    expect(normalizeModelName('Claude-Sonnet-4-6')).toBe('claude-sonnet-4-6')
    expect(normalizeModelName('models/gemini-2.5-flash')).toBe('gemini-2.5-flash')
    expect(normalizeModelName('openai/gpt-5-codex')).toBe('gpt-5-codex')
    expect(normalizeModelName('xai/grok-4.20-0309-non-reasoning')).toBe('grok-4.20-0309-non-reasoning')
    expect(normalizeModelName('qwen/qwen3.6-plus-04-02:free')).toBe('qwen3.6-plus-04-02')
  })
})

describe('getPricing', () => {
  it('has exact current seed rows for core provider models', () => {
    expect(getPricing('claude-3-5-haiku')).toMatchObject({
      inputPer1M: 0.80,
      outputPer1M: 4.00,
      cacheReadPer1M: 0.08,
      cacheWritePer1M: 1.00,
      cacheWrite1hPer1M: 1.60,
    })
    expect(getPricing('gpt-5.5')).toMatchObject({
      inputPer1M: 5.00,
      outputPer1M: 30.00,
      cacheReadPer1M: 0.50,
    })
    expect(getPricing('gpt-5.5-pro')).toMatchObject({
      inputPer1M: 30.00,
      outputPer1M: 180.00,
      cacheReadPer1M: 0,
    })
    expect(getPricing('gpt-5.4-nano')).toMatchObject({
      inputPer1M: 0.20,
      outputPer1M: 1.25,
      cacheReadPer1M: 0.02,
    })
    expect(getPricing('gpt-5-codex')).toMatchObject({
      inputPer1M: 1.25,
      outputPer1M: 10.00,
      cacheReadPer1M: 0.125,
    })
    expect(getPricing('gemini-2.5-flash')).toMatchObject({
      inputPer1M: 0.30,
      outputPer1M: 2.50,
      cacheReadPer1M: 0.03,
    })
    expect(getPricing('gemini-3.1-flash-lite')).toMatchObject({
      inputPer1M: 0.25,
      outputPer1M: 1.50,
      cacheReadPer1M: 0.025,
    })
    expect(getPricing('grok-4.20-0309-non-reasoning')).toMatchObject({
      inputPer1M: 1.25,
      outputPer1M: 2.50,
      cacheReadPer1M: 0.20,
    })
    expect(getPricing('grok-4.3')).toMatchObject({
      inputPer1M: 1.25,
      outputPer1M: 2.50,
      cacheReadPer1M: 0.20,
    })
    expect(getPricing('grok-4-1-fast-non-reasoning')).toMatchObject({
      inputPer1M: 0.20,
      outputPer1M: 0.50,
      cacheReadPer1M: 0.05,
    })
    expect(getPricing('grok-code-fast-1')).toMatchObject({
      inputPer1M: 0.20,
      outputPer1M: 1.50,
      cacheReadPer1M: 0.02,
    })
  })

  it('returns pricing for every known default model', () => {
    for (const model of Object.keys(DEFAULT_PRICING)) {
      expect(getPricing(model), model).not.toBeNull()
    }
  })

  it('uses the longest prefix match for overlapping model names', () => {
    expect(getPricing('gpt-5.4-pro-extra')).toMatchObject({ inputPer1M: 30.00, outputPer1M: 180.00 })
    expect(getPricing('gpt-5.4-mini-2026-01-01')).toMatchObject({ inputPer1M: 0.75, outputPer1M: 4.50 })
    expect(getPricing('gemini-3.1-pro-preview-customtools')).toMatchObject({ inputPer1M: 2.00, outputPer1M: 12.00 })
    expect(getPricing('grok-4-1-fast-reasoning-latest')).toMatchObject({ inputPer1M: 0.20, outputPer1M: 0.50 })
  })

  it('returns null for unknown models', () => {
    expect(getPricing('unknown-model-xyz')).toBeNull()
  })
})

describe('computeCost', () => {
  it('computes input, output, cache read, 5m cache write, and 1h cache write', () => {
    const cost = computeCost('claude-sonnet-4-6', 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(28.05)
  })

  it('uses Gemini Pro long-prompt pricing above 200k prompt tokens', () => {
    expect(computeCost('gemini-2.5-pro', 150_000, 10_000, 25_000)).toBeCloseTo(0.290625)
    expect(computeCost('gemini-2.5-pro', 190_000, 10_000, 25_000)).toBeCloseTo(0.63125)
    expect(computeCost('gemini-3.1-pro-preview', 150_000, 10_000, 25_000)).toBeCloseTo(0.425)
    expect(computeCost('gemini-3.1-pro-preview', 190_000, 10_000, 25_000)).toBeCloseTo(0.95)
  })

  it('uses OpenAI long-context pricing above 272k prompt tokens for 1.05M-context models', () => {
    expect(computeCost('gpt-5.5', 250_000, 10_000, 10_000)).toBeCloseTo(1.555)
    expect(computeCost('gpt-5.5', 300_000, 10_000, 10_000)).toBeCloseTo(3.46)
    expect(computeCost('gpt-5.4-pro', 300_000, 10_000)).toBeCloseTo(20.7)
    expect(computeCost('gpt-5.4-mini', 300_000, 10_000, 10_000)).toBeCloseTo(0.27075)
  })

  it('uses xAI long-context pricing above provider thresholds', () => {
    expect(computeCost('grok-4.3', 180_000, 10_000, 10_000)).toBeCloseTo(0.255)
    expect(computeCost('grok-4.3', 190_000, 10_000, 20_000)).toBeCloseTo(0.533)
    expect(computeCost('grok-4.20-0309-non-reasoning', 190_000, 10_000, 20_000)).toBeCloseTo(0.533)
    expect(computeCost('grok-4-1-fast-reasoning-latest', 120_000, 10_000, 5_000)).toBeCloseTo(0.02925)
    expect(computeCost('grok-4-1-fast-reasoning-latest', 130_000, 10_000, 5_000)).toBeCloseTo(0.06225)
    expect(computeCost('grok-4', 130_000, 10_000, 5_000)).toBeCloseTo(1.08375)
  })

  it('returns 0 for unknown model or zero tokens', () => {
    expect(computeCost('unknown-xyz', 100_000, 50_000)).toBe(0)
    expect(computeCost('claude-sonnet-4-6', 0, 0)).toBe(0)
  })
})

describe('ensurePricingSeeded', () => {
  it('updates stale default rows and preserves the 1h cache write column', () => {
    const db = openDatabase(':memory:', true)
    upsertModelPricing(db, {
      model: 'gpt-5-codex',
      input_per_1m: 1.75,
      output_per_1m: 14,
      cache_read_per_1m: 0.44,
      cache_write_per_1m: 0,
      cache_write_1h_per_1m: 0,
      updated_at: '2025-01-01T00:00:00.000Z',
    })

    ensurePricingSeeded(db)

    const row = getModelPricing(db, 'gpt-5-codex')
    expect(row?.input_per_1m).toBe(1.25)
    expect(row?.output_per_1m).toBe(10)
    expect(row?.cache_read_per_1m).toBe(0.125)
    expect(row?.cache_write_1h_per_1m).toBe(0)
  })

  it('repairs default rows that were seeded before 1h cache write pricing existed', () => {
    const db = openDatabase(':memory:', true)
    upsertModelPricing(db, {
      model: 'claude-sonnet-4-6',
      input_per_1m: 3,
      output_per_1m: 15,
      cache_read_per_1m: 0.3,
      cache_write_per_1m: 3.75,
      cache_write_1h_per_1m: 0,
      updated_at: '2026-05-08T00:00:00.000Z',
    })

    ensurePricingSeeded(db)

    const row = getModelPricing(db, 'claude-sonnet-4-6')
    expect(row?.cache_write_1h_per_1m).toBe(6)
  })

  it('repairs stale Gemini cache-read defaults', () => {
    const db = openDatabase(':memory:', true)
    upsertModelPricing(db, {
      model: 'gemini-2.5-pro',
      input_per_1m: 1.25,
      output_per_1m: 10,
      cache_read_per_1m: 0,
      cache_write_per_1m: 0,
      cache_write_1h_per_1m: 0,
      updated_at: '2026-05-08T00:00:00.000Z',
    })

    ensurePricingSeeded(db)

    const row = getModelPricing(db, 'gemini-2.5-pro')
    expect(row?.cache_read_per_1m).toBe(0.125)
  })

  it('does not overwrite custom user-edited pricing rows', () => {
    const db = openDatabase(':memory:', true)
    upsertModelPricing(db, {
      model: 'gpt-5-codex',
      input_per_1m: 9,
      output_per_1m: 99,
      cache_read_per_1m: 3,
      cache_write_per_1m: 0,
      cache_write_1h_per_1m: 0,
      updated_at: '2026-05-08T00:00:00.000Z',
    })

    ensurePricingSeeded(db)

    const row = getModelPricing(db, 'gpt-5-codex')
    expect(row?.input_per_1m).toBe(9)
    expect(row?.output_per_1m).toBe(99)
    expect(row?.cache_read_per_1m).toBe(3)
  })
})
