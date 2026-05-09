import { describe, it, expect } from 'bun:test'
import { normalizeModelName, getPricing, getPricingFromDb, computeCost, DEFAULT_PRICING, ensurePricingSeeded } from './pricing.js'
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
    expect(getPricing('o1-mini')).toMatchObject({
      inputPer1M: 1.10,
      outputPer1M: 4.40,
      cacheReadPer1M: 0.55,
    })
    expect(getPricing('gemini-2.5-flash')).toMatchObject({
      inputPer1M: 0.30,
      outputPer1M: 2.50,
      cacheReadPer1M: 0.03,
      cacheStoragePer1MHour: 1.00,
    })
    expect(getPricing('gemini-2.5-flash-lite')).toMatchObject({
      inputPer1M: 0.10,
      outputPer1M: 0.40,
      cacheReadPer1M: 0.01,
      cacheStoragePer1MHour: 1.00,
    })
    expect(getPricing('gemini-3.1-flash-lite')).toMatchObject({
      inputPer1M: 0.25,
      outputPer1M: 1.50,
      cacheReadPer1M: 0.025,
      cacheStoragePer1MHour: 1.00,
    })
    expect(getPricing('gemini-2.0-flash-lite')).toMatchObject({
      inputPer1M: 0.075,
      outputPer1M: 0.30,
      cacheReadPer1M: 0,
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
    expect(getPricing('grok-3')).toMatchObject({
      inputPer1M: 3.00,
      outputPer1M: 15.00,
      cacheReadPer1M: 0.75,
    })
    expect(getPricing('grok-3-mini')).toMatchObject({
      inputPer1M: 0.30,
      outputPer1M: 0.50,
      cacheReadPer1M: 0.07,
    })
    expect(getPricing('kimi-k2.6')).toMatchObject({
      inputPer1M: 0.95,
      outputPer1M: 4.00,
      cacheReadPer1M: 0.16,
    })
    expect(getPricing('kimi-k2.5')).toMatchObject({
      inputPer1M: 0.60,
      outputPer1M: 3.00,
      cacheReadPer1M: 0.10,
    })
    expect(getPricing('kimi-k2')).toMatchObject({
      inputPer1M: 0.60,
      outputPer1M: 2.50,
      cacheReadPer1M: 0.15,
    })
  })

  it('has exact current seed rows for community and provider-routed models', () => {
    expect(getPricing('qwen/qwen3.6-plus-04-02')).toMatchObject({
      inputPer1M: 0.325,
      outputPer1M: 1.95,
      cacheReadPer1M: 0.0325,
      cacheWritePer1M: 0.40625,
    })
    expect(getPricing('qwen/qwen3.6-flash')).toMatchObject({
      inputPer1M: 0.25,
      outputPer1M: 1.50,
      cacheReadPer1M: 0.025,
      cacheWritePer1M: 0.3125,
    })
    expect(getPricing('qwen/qwen3.6-35b-a3b')).toMatchObject({
      inputPer1M: 0.15,
      outputPer1M: 1.00,
      cacheReadPer1M: 0.05,
    })
    expect(getPricing('qwen/qwen3.6-max-preview')).toMatchObject({
      inputPer1M: 1.04,
      outputPer1M: 6.24,
      cacheReadPer1M: 0.104,
      cacheWritePer1M: 1.30,
    })
    expect(getPricing('minimax-m2.7')).toMatchObject({
      inputPer1M: 0.30,
      outputPer1M: 1.20,
      cacheReadPer1M: 0.06,
      cacheWritePer1M: 0.375,
    })
    expect(getPricing('minimax/minimax-m2.7')).toMatchObject({
      inputPer1M: 0.299,
      outputPer1M: 1.20,
      cacheReadPer1M: 0,
      cacheWritePer1M: 0,
    })
    expect(getPricing('minimax-m2.7-highspeed')).toMatchObject({
      inputPer1M: 0.60,
      outputPer1M: 2.40,
      cacheReadPer1M: 0.06,
      cacheWritePer1M: 0.375,
    })
    expect(getPricing('minimax/minimax-m1')).toMatchObject({
      inputPer1M: 0.40,
      outputPer1M: 2.20,
    })
    const googleGeminiPro = getPricing('google/gemini-2.5-pro')
    expect(googleGeminiPro).toMatchObject({
      inputPer1M: 1.25,
      outputPer1M: 10.00,
      cacheReadPer1M: 0.125,
      cacheWritePer1M: 0.375,
    })
    expect(googleGeminiPro?.cacheStoragePer1MHour ?? 0).toBe(0)
    const googleGeminiFlash = getPricing('google/gemini-2.5-flash')
    expect(googleGeminiFlash).toMatchObject({
      inputPer1M: 0.30,
      outputPer1M: 2.50,
      cacheReadPer1M: 0.03,
      cacheWritePer1M: 0.08333333333333334,
    })
    expect(googleGeminiFlash?.cacheStoragePer1MHour ?? 0).toBe(0)
    expect(getPricing('glm-5.1')).toMatchObject({
      inputPer1M: 1.40,
      outputPer1M: 4.40,
      cacheReadPer1M: 0.26,
    })
    expect(getPricing('z-ai/glm-5.1')).toMatchObject({
      inputPer1M: 1.05,
      outputPer1M: 3.50,
      cacheReadPer1M: 0.525,
    })
    expect(getPricing('glm-5')).toMatchObject({
      inputPer1M: 1.00,
      outputPer1M: 3.20,
      cacheReadPer1M: 0.20,
    })
    expect(getPricing('z-ai/glm-5')).toMatchObject({
      inputPer1M: 0.60,
      outputPer1M: 1.92,
      cacheReadPer1M: 0.12,
    })
    expect(getPricing('moonshotai/kimi-k2.6')).toMatchObject({
      inputPer1M: 0.75,
      outputPer1M: 3.50,
      cacheReadPer1M: 0.15,
    })
    expect(getPricing('moonshotai/kimi-k2.5')).toMatchObject({
      inputPer1M: 0.44,
      outputPer1M: 2.00,
      cacheReadPer1M: 0.22,
    })
    expect(getPricing('moonshotai/kimi-k2')).toMatchObject({
      inputPer1M: 0.57,
      outputPer1M: 2.30,
      cacheReadPer1M: 0,
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
    expect(getPricing('gemini-2.0-flash-lite-001')).toMatchObject({ inputPer1M: 0.075, outputPer1M: 0.30, cacheReadPer1M: 0 })
    expect(getPricing('grok-4-1-fast-reasoning-latest')).toMatchObject({ inputPer1M: 0.20, outputPer1M: 0.50 })
    expect(getPricing('kimi-k2.6-20260419')).toMatchObject({ inputPer1M: 0.95, outputPer1M: 4.00, cacheReadPer1M: 0.16 })
    expect(getPricing('moonshotai/kimi-k2.6-20260419')).toMatchObject({ inputPer1M: 0.75, outputPer1M: 3.50, cacheReadPer1M: 0.15 })
    expect(getPricing('qwen/qwen3.6-plus-04-02')).toMatchObject({ inputPer1M: 0.325, outputPer1M: 1.95, cacheReadPer1M: 0.0325, cacheWritePer1M: 0.40625 })
    expect(getPricing('qwen/qwen3.6-flash-20260420')).toMatchObject({ inputPer1M: 0.25, outputPer1M: 1.50, cacheReadPer1M: 0.025, cacheWritePer1M: 0.3125 })
    expect(getPricing('z-ai/glm-5.1-20260406')).toMatchObject({ inputPer1M: 1.05, outputPer1M: 3.50, cacheReadPer1M: 0.525 })
  })

  it('returns null for unknown models', () => {
    expect(getPricing('unknown-model-xyz')).toBeNull()
    expect(getPricing('qwen3.6')).toBeNull()
    expect(getPricing('claude-3-5-sonnet')).toBeNull()
    expect(getPricing('claude-3-sonnet')).toBeNull()
    expect(getPricing('gemini-3.1-pro')).toBeNull()
    expect(getPricing('gemini-1.5-pro')).toBeNull()
    expect(getPricing('gemini-1.5-flash')).toBeNull()
    expect(getPricing('gpt-5.3-chat')).toBeNull()
  })

  it('treats explicit free model variants as zero-cost rows', () => {
    expect(getPricing('qwen/qwen3.6-plus-04-02:free')).toMatchObject({
      inputPer1M: 0,
      outputPer1M: 0,
      cacheReadPer1M: 0,
      cacheWritePer1M: 0,
    })
  })
})

describe('getPricingFromDb', () => {
  it('reads exact DB pricing and backfills missing 1h cache write for current defaults', () => {
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

    expect(getPricingFromDb(db, 'anthropic/claude-sonnet-4-6-20260217')).toMatchObject({
      inputPer1M: 3,
      outputPer1M: 15,
      cacheReadPer1M: 0.3,
      cacheWritePer1M: 3.75,
      cacheWrite1hPer1M: 6,
    })
  })

  it('uses DB longest-prefix pricing for custom model families', () => {
    const db = openDatabase(':memory:', true)
    upsertModelPricing(db, {
      model: 'local-model',
      input_per_1m: 0.12,
      output_per_1m: 0.34,
      cache_read_per_1m: 0.05,
      cache_write_per_1m: 0.06,
      cache_write_1h_per_1m: 0.09,
      cache_storage_per_1m_hour: 0.11,
      updated_at: '2026-05-08T00:00:00.000Z',
    })

    expect(getPricingFromDb(db, 'local-model-large-20260509')).toMatchObject({
      inputPer1M: 0.12,
      outputPer1M: 0.34,
      cacheReadPer1M: 0.05,
      cacheWritePer1M: 0.06,
      cacheWrite1hPer1M: 0.09,
      cacheStoragePer1MHour: 0.11,
    })
  })

  it('returns null for unknown DB models and zero for explicit free variants', () => {
    const db = openDatabase(':memory:', true)

    expect(getPricingFromDb(db, 'unknown-db-model')).toBeNull()
    expect(getPricingFromDb(db, 'qwen/qwen3.6-plus-04-02:free')).toMatchObject({
      inputPer1M: 0,
      outputPer1M: 0,
      cacheReadPer1M: 0,
      cacheWritePer1M: 0,
    })
  })

  it('prefers provider-qualified DB pricing before unqualified fallback rows', () => {
    const db = openDatabase(':memory:', true)
    ensurePricingSeeded(db)

    expect(getPricingFromDb(db, 'z-ai/glm-5.1')).toMatchObject({
      inputPer1M: 1.05,
      outputPer1M: 3.50,
      cacheReadPer1M: 0.525,
    })
    expect(getPricingFromDb(db, 'glm-5.1')).toMatchObject({
      inputPer1M: 1.40,
      outputPer1M: 4.40,
      cacheReadPer1M: 0.26,
    })
    expect(getPricingFromDb(db, 'minimax/minimax-m2.7')).toMatchObject({
      inputPer1M: 0.299,
      outputPer1M: 1.20,
      cacheReadPer1M: 0,
      cacheWritePer1M: 0,
    })
    expect(getPricingFromDb(db, 'minimax-m2.7')).toMatchObject({
      inputPer1M: 0.30,
      outputPer1M: 1.20,
      cacheReadPer1M: 0.06,
      cacheWritePer1M: 0.375,
    })
    expect(getPricingFromDb(db, 'moonshotai/kimi-k2.6')).toMatchObject({
      inputPer1M: 0.75,
      outputPer1M: 3.50,
      cacheReadPer1M: 0.15,
    })
    expect(getPricingFromDb(db, 'kimi-k2.6')).toMatchObject({
      inputPer1M: 0.95,
      outputPer1M: 4.00,
      cacheReadPer1M: 0.16,
    })
    expect(getPricingFromDb(db, 'google/gemini-2.5-pro')).toMatchObject({
      inputPer1M: 1.25,
      outputPer1M: 10.00,
      cacheReadPer1M: 0.125,
      cacheWritePer1M: 0.375,
      cacheStoragePer1MHour: 0,
    })
    expect(getPricingFromDb(db, 'gemini-2.5-pro')).toMatchObject({
      inputPer1M: 1.25,
      outputPer1M: 10.00,
      cacheReadPer1M: 0.125,
      cacheWritePer1M: 0,
      cacheStoragePer1MHour: 4.5,
    })
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
    expect(computeCost('gemini-2.0-flash-lite', 100_000, 10_000, 50_000)).toBeCloseTo(0.0105)
  })

  it('accounts for Gemini context cache storage token-hours when provided', () => {
    expect(computeCost('gemini-3.1-pro-preview', 0, 0, 0, 0, 0, 1_000_000)).toBeCloseTo(4.50)
    expect(computeCost('gemini-3.1-flash-lite', 0, 0, 0, 0, 0, 1_000_000)).toBeCloseTo(1.00)
    expect(computeCost('gemini-2.5-flash', 0, 0, 0, 0, 0, 1_000_000)).toBeCloseTo(1.00)
    expect(computeCost('gemini-2.5-flash-lite', 0, 0, 0, 0, 0, 1_000_000)).toBeCloseTo(1.00)
  })

  it('uses OpenAI long-context pricing above 272k prompt tokens for 1.05M-context models', () => {
    expect(computeCost('gpt-5.5', 250_000, 10_000, 10_000)).toBeCloseTo(1.555)
    expect(computeCost('gpt-5.5', 300_000, 10_000, 10_000)).toBeCloseTo(3.46)
    expect(computeCost('gpt-5.5-pro', 300_000, 10_000)).toBeCloseTo(10.8)
    expect(computeCost('gpt-5.4-pro', 300_000, 10_000)).toBeCloseTo(20.7)
    expect(computeCost('gpt-5.4-mini', 300_000, 10_000, 10_000)).toBeCloseTo(0.27075)
  })

  it('uses Qwen and MiniMax long-prompt tiers without crossing router/direct schemas', () => {
    expect(computeCost('qwen/qwen3.6-flash', 200_000, 10_000, 10_000, 10_000)).toBeCloseTo(0.068375)
    expect(computeCost('qwen/qwen3.6-flash', 300_000, 10_000, 10_000, 10_000)).toBeCloseTo(0.3535)
    expect(computeCost('qwen/qwen3.6-plus-04-02', 260_000, 10_000, 10_000, 10_000)).toBeCloseTo(0.39455)
    expect(computeCost('qwen/qwen3.6-max-preview', 150_000, 10_000, 10_000, 10_000)).toBeCloseTo(0.3576)
    expect(computeCost('minimax-m1', 150_000, 10_000)).toBeCloseTo(0.082)
    expect(computeCost('minimax-m1', 300_000, 10_000)).toBeCloseTo(0.412)
    expect(computeCost('minimax/minimax-m1', 300_000, 10_000)).toBeCloseTo(0.142)
  })

  it('uses xAI long-context pricing above provider thresholds', () => {
    expect(computeCost('grok-4.3', 180_000, 10_000, 10_000)).toBeCloseTo(0.255)
    expect(computeCost('grok-4.3', 190_000, 10_000, 20_000)).toBeCloseTo(0.533)
    expect(computeCost('grok-4.20-0309-non-reasoning', 190_000, 10_000, 20_000)).toBeCloseTo(0.533)
    expect(computeCost('grok-4-1-fast-reasoning-latest', 120_000, 10_000, 5_000)).toBeCloseTo(0.02925)
    expect(computeCost('grok-4-1-fast-reasoning-latest', 130_000, 10_000, 5_000)).toBeCloseTo(0.062)
    expect(computeCost('grok-4', 130_000, 10_000, 5_000)).toBeCloseTo(1.08)
  })

  it('returns 0 for unknown model or zero tokens', () => {
    expect(computeCost('unknown-xyz', 100_000, 50_000)).toBe(0)
    expect(computeCost('claude-sonnet-4-6', 0, 0)).toBe(0)
    expect(computeCost('qwen/qwen3.6-plus-04-02:free', 1_000_000, 1_000_000, 1_000_000)).toBe(0)
  })

  it('keeps direct-provider and router pricing schemas separate', () => {
    expect(computeCost('glm-5.1', 1_000_000, 1_000_000, 1_000_000)).toBeCloseTo(6.06)
    expect(computeCost('z-ai/glm-5.1', 1_000_000, 1_000_000, 1_000_000)).toBeCloseTo(5.075)
    expect(computeCost('minimax-m2.7', 1_000_000, 1_000_000, 1_000_000, 1_000_000)).toBeCloseTo(1.935)
    expect(computeCost('minimax/minimax-m2.7', 1_000_000, 1_000_000, 1_000_000, 1_000_000)).toBeCloseTo(1.499)
    expect(computeCost('kimi-k2.6', 1_000_000, 1_000_000, 1_000_000)).toBeCloseTo(5.11)
    expect(computeCost('moonshotai/kimi-k2.6', 1_000_000, 1_000_000, 1_000_000)).toBeCloseTo(4.4)
    expect(computeCost('gemini-2.5-pro', 1_000_000, 1_000_000, 1_000_000, 1_000_000, 0, 1_000_000)).toBeCloseTo(22.25)
    expect(computeCost('google/gemini-2.5-pro', 1_000_000, 1_000_000, 1_000_000, 1_000_000, 0, 1_000_000)).toBeCloseTo(18.125)
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

  it('repairs stale OpenAI and xAI cached-input defaults', () => {
    const db = openDatabase(':memory:', true)
    upsertModelPricing(db, {
      model: 'gpt-5.3-codex',
      input_per_1m: 1.75,
      output_per_1m: 14,
      cache_read_per_1m: 0.44,
      cache_write_per_1m: 0,
      cache_write_1h_per_1m: 0,
      updated_at: '2025-01-01T00:00:00.000Z',
    })
    upsertModelPricing(db, {
      model: 'gpt-5.2-codex',
      input_per_1m: 1.75,
      output_per_1m: 14,
      cache_read_per_1m: 0.44,
      cache_write_per_1m: 0,
      cache_write_1h_per_1m: 0,
      updated_at: '2025-01-01T00:00:00.000Z',
    })
    upsertModelPricing(db, {
      model: 'o1-mini',
      input_per_1m: 3,
      output_per_1m: 12,
      cache_read_per_1m: 1.5,
      cache_write_per_1m: 0,
      cache_write_1h_per_1m: 0,
      updated_at: '2025-01-01T00:00:00.000Z',
    })
    upsertModelPricing(db, {
      model: 'grok-3',
      input_per_1m: 3,
      output_per_1m: 15,
      cache_read_per_1m: 0,
      cache_write_per_1m: 0,
      cache_write_1h_per_1m: 0,
      updated_at: '2025-01-01T00:00:00.000Z',
    })

    ensurePricingSeeded(db)

    expect(getModelPricing(db, 'gpt-5.3-codex')?.cache_read_per_1m).toBe(0.175)
    expect(getModelPricing(db, 'gpt-5.2-codex')?.cache_read_per_1m).toBe(0.175)
    expect(getModelPricing(db, 'o1-mini')?.cache_read_per_1m).toBe(0.55)
    expect(getModelPricing(db, 'grok-3')?.cache_read_per_1m).toBe(0.75)
  })

  it('repairs stale Kimi K2 default pricing', () => {
    const db = openDatabase(':memory:', true)
    upsertModelPricing(db, {
      model: 'kimi-k2',
      input_per_1m: 0.60,
      output_per_1m: 0.60,
      cache_read_per_1m: 0,
      cache_write_per_1m: 0,
      cache_write_1h_per_1m: 0,
      updated_at: '2026-05-08T00:00:00.000Z',
    })

    ensurePricingSeeded(db)

    const row = getModelPricing(db, 'kimi-k2')
    expect(row?.input_per_1m).toBe(0.60)
    expect(row?.output_per_1m).toBe(2.50)
    expect(row?.cache_read_per_1m).toBe(0.15)
  })

  it('repairs stale community provider defaults and removes broad Qwen family rows', () => {
    const db = openDatabase(':memory:', true)
    const staleRows = [
      ['qwen3.6-plus', 0.80, 2.00, 0, 0],
      ['qwen3.6', 0.30, 0.60, 0, 0],
      ['qwen3.6-flash', 0.25, 1.50, 0, 0.3125],
      ['qwen3.6-max-preview', 1.04, 6.24, 0, 1.30],
      ['qwen/qwen3.6-plus', 0.325, 1.95, 0.05, 0.40625],
      ['qwen/qwen3.6-flash', 0.25, 1.50, 0, 0.3125],
      ['qwen/qwen3.6-max-preview', 1.04, 6.24, 0.13, 1.30],
      ['minimax-m2.7', 0.70, 0.70, 0, 0],
      ['minimax-m2.7-highspeed', 0.70, 0.70, 0, 0],
      ['minimax-m1', 0.20, 1.10, 0, 0],
      ['glm-5.1', 0.70, 0.70, 0, 0],
      ['glm-5', 0.70, 0.70, 0, 0],
    ] as const

    for (const [model, input, output, cacheRead, cacheWrite] of staleRows) {
      upsertModelPricing(db, {
        model,
        input_per_1m: input,
        output_per_1m: output,
        cache_read_per_1m: cacheRead,
        cache_write_per_1m: cacheWrite,
        cache_write_1h_per_1m: 0,
        updated_at: '2026-05-08T00:00:00.000Z',
      })
    }

    ensurePricingSeeded(db)

    expect(getModelPricing(db, 'qwen3.6')).toBeNull()
    expect(getModelPricing(db, 'qwen3.6-plus')).toMatchObject({
      input_per_1m: 0.325,
      output_per_1m: 1.95,
      cache_read_per_1m: 0.0325,
      cache_write_per_1m: 0.40625,
    })
    expect(getModelPricing(db, 'qwen3.6-flash')).toMatchObject({
      input_per_1m: 0.25,
      output_per_1m: 1.50,
      cache_read_per_1m: 0.025,
      cache_write_per_1m: 0.3125,
    })
    expect(getModelPricing(db, 'qwen3.6-max-preview')).toMatchObject({
      input_per_1m: 1.04,
      output_per_1m: 6.24,
      cache_read_per_1m: 0.104,
      cache_write_per_1m: 1.30,
    })
    expect(getModelPricing(db, 'qwen/qwen3.6-plus')).toMatchObject({
      input_per_1m: 0.325,
      output_per_1m: 1.95,
      cache_read_per_1m: 0.0325,
      cache_write_per_1m: 0.40625,
    })
    expect(getModelPricing(db, 'qwen/qwen3.6-flash')).toMatchObject({
      input_per_1m: 0.25,
      output_per_1m: 1.50,
      cache_read_per_1m: 0.025,
      cache_write_per_1m: 0.3125,
    })
    expect(getModelPricing(db, 'qwen/qwen3.6-max-preview')).toMatchObject({
      input_per_1m: 1.04,
      output_per_1m: 6.24,
      cache_read_per_1m: 0.104,
      cache_write_per_1m: 1.30,
    })
    expect(getModelPricing(db, 'minimax-m2.7')).toMatchObject({
      input_per_1m: 0.30,
      output_per_1m: 1.20,
      cache_read_per_1m: 0.06,
      cache_write_per_1m: 0.375,
    })
    expect(getModelPricing(db, 'minimax-m2.7-highspeed')).toMatchObject({
      input_per_1m: 0.60,
      output_per_1m: 2.40,
      cache_read_per_1m: 0.06,
      cache_write_per_1m: 0.375,
    })
    expect(getModelPricing(db, 'minimax-m1')).toMatchObject({
      input_per_1m: 0.40,
      output_per_1m: 2.20,
    })
    expect(getModelPricing(db, 'glm-5.1')).toMatchObject({
      input_per_1m: 1.40,
      output_per_1m: 4.40,
      cache_read_per_1m: 0.26,
    })
    expect(getModelPricing(db, 'glm-5')).toMatchObject({
      input_per_1m: 1.00,
      output_per_1m: 3.20,
      cache_read_per_1m: 0.20,
    })
    expect(getPricingFromDb(db, 'qwen/qwen3.6-flash')).toMatchObject({
      inputPer1M: 0.25,
      outputPer1M: 1.50,
      cacheWritePer1M: 0.3125,
    })
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
    expect(row?.cache_storage_per_1m_hour).toBe(4.5)
  })

  it('repairs current Gemini default rows missing storage pricing', () => {
    const db = openDatabase(':memory:', true)
    const rows = [
      ['gemini-3.1-pro-preview', 2, 12, 0.2, 4.5],
      ['gemini-2.5-flash', 0.3, 2.5, 0.03, 1],
      ['gemini-2.5-flash-lite', 0.1, 0.4, 0.01, 1],
    ] as const

    for (const [model, input, output, cacheRead] of rows) {
      upsertModelPricing(db, {
        model,
        input_per_1m: input,
        output_per_1m: output,
        cache_read_per_1m: cacheRead,
        cache_write_per_1m: 0,
        cache_write_1h_per_1m: 0,
        cache_storage_per_1m_hour: 0,
        updated_at: '2026-05-08T00:00:00.000Z',
      })
    }

    ensurePricingSeeded(db)

    for (const [model, , , , storage] of rows) {
      const row = getModelPricing(db, model)
      expect(row?.cache_storage_per_1m_hour).toBe(storage)
    }
  })

  it('removes deprecated default rows that no longer have current provider pricing', () => {
    const db = openDatabase(':memory:', true)
    upsertModelPricing(db, {
      model: 'claude-3-5-sonnet',
      input_per_1m: 3,
      output_per_1m: 15,
      cache_read_per_1m: 0.3,
      cache_write_per_1m: 3.75,
      cache_write_1h_per_1m: 6,
      updated_at: '2026-05-08T00:00:00.000Z',
    })
    upsertModelPricing(db, {
      model: 'gemini-1.5-pro',
      input_per_1m: 1.25,
      output_per_1m: 5,
      cache_read_per_1m: 0,
      cache_write_per_1m: 0,
      cache_write_1h_per_1m: 0,
      updated_at: '2026-05-08T00:00:00.000Z',
    })

    ensurePricingSeeded(db)

    expect(getModelPricing(db, 'claude-3-5-sonnet')).toBeNull()
    expect(getModelPricing(db, 'gemini-1.5-pro')).toBeNull()
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
