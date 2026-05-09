import type { SqliteAdapter as Database } from '@hasna/cloud'
import type { ModelPricing } from '../types/index.js'
import { getModelPricing, seedModelPricing, upsertModelPricing } from '../db/database.js'

// Default pricing seed data (USD per 1M tokens).
// These are written to SQLite and can be edited via `economy pricing set`.
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // Claude. cacheWritePer1M is the 5-minute cache write rate;
  // cacheWrite1hPer1M is the 1-hour cache write rate.
  'claude-opus-4-7':    { inputPer1M: 5.00,  outputPer1M: 25.00, cacheReadPer1M: 0.50,  cacheWritePer1M: 6.25,  cacheWrite1hPer1M: 10.00 },
  'claude-opus-4-6':    { inputPer1M: 5.00,  outputPer1M: 25.00, cacheReadPer1M: 0.50,  cacheWritePer1M: 6.25,  cacheWrite1hPer1M: 10.00 },
  'claude-opus-4-5':    { inputPer1M: 5.00,  outputPer1M: 25.00, cacheReadPer1M: 0.50,  cacheWritePer1M: 6.25,  cacheWrite1hPer1M: 10.00 },
  'claude-opus-4-1':    { inputPer1M: 15.00, outputPer1M: 75.00, cacheReadPer1M: 1.50,  cacheWritePer1M: 18.75, cacheWrite1hPer1M: 30.00 },
  'claude-opus-4':      { inputPer1M: 15.00, outputPer1M: 75.00, cacheReadPer1M: 1.50,  cacheWritePer1M: 18.75, cacheWrite1hPer1M: 30.00 },
  'claude-sonnet-4-6':  { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0.30,  cacheWritePer1M: 3.75,  cacheWrite1hPer1M: 6.00 },
  'claude-sonnet-4-5':  { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0.30,  cacheWritePer1M: 3.75,  cacheWrite1hPer1M: 6.00 },
  'claude-sonnet-4':    { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0.30,  cacheWritePer1M: 3.75,  cacheWrite1hPer1M: 6.00 },
  'claude-3-7-sonnet':  { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0.30,  cacheWritePer1M: 3.75,  cacheWrite1hPer1M: 6.00 },
  'claude-3-5-sonnet':  { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0.30,  cacheWritePer1M: 3.75,  cacheWrite1hPer1M: 6.00 },
  'claude-haiku-4-5':   { inputPer1M: 1.00,  outputPer1M: 5.00,  cacheReadPer1M: 0.10,  cacheWritePer1M: 1.25,  cacheWrite1hPer1M: 2.00 },
  'claude-3-5-haiku':   { inputPer1M: 0.80,  outputPer1M: 4.00,  cacheReadPer1M: 0.08,  cacheWritePer1M: 1.00,  cacheWrite1hPer1M: 1.60 },
  'claude-3-opus':      { inputPer1M: 15.00, outputPer1M: 75.00, cacheReadPer1M: 1.50,  cacheWritePer1M: 18.75, cacheWrite1hPer1M: 30.00 },
  'claude-3-sonnet':    { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0.30,  cacheWritePer1M: 3.75,  cacheWrite1hPer1M: 6.00 },
  'claude-3-haiku':     { inputPer1M: 0.25,  outputPer1M: 1.25, cacheReadPer1M: 0.03,  cacheWritePer1M: 0.30,  cacheWrite1hPer1M: 0.50 },

  // Gemini standard text/image/video paid tier rates.
  'gemini-3.1-pro-preview': { inputPer1M: 2.00, outputPer1M: 12.00, cacheReadPer1M: 0.20, cacheWritePer1M: 0 },
  'gemini-3.1-pro':     { inputPer1M: 2.00,  outputPer1M: 12.00, cacheReadPer1M: 0.20,  cacheWritePer1M: 0 },
  'gemini-3-flash-preview': { inputPer1M: 0.50, outputPer1M: 3.00, cacheReadPer1M: 0.05, cacheWritePer1M: 0 },
  'gemini-2.5-pro':     { inputPer1M: 1.25,  outputPer1M: 10.00, cacheReadPer1M: 0.125, cacheWritePer1M: 0 },
  'gemini-2.5-flash':   { inputPer1M: 0.30,  outputPer1M: 2.50,  cacheReadPer1M: 0.03,  cacheWritePer1M: 0 },
  'gemini-2.5-flash-lite': { inputPer1M: 0.10, outputPer1M: 0.40, cacheReadPer1M: 0.01, cacheWritePer1M: 0 },
  'gemini-2.0-flash':   { inputPer1M: 0.10,  outputPer1M: 0.40,  cacheReadPer1M: 0.025, cacheWritePer1M: 0 },
  'gemini-1.5-pro':     { inputPer1M: 1.25,  outputPer1M: 5.00,  cacheReadPer1M: 0,     cacheWritePer1M: 0 },
  'gemini-1.5-flash':   { inputPer1M: 0.075, outputPer1M: 0.30,  cacheReadPer1M: 0,     cacheWritePer1M: 0 },

  // OpenAI standard text token rates.
  'gpt-5.5':            { inputPer1M: 5.00,  outputPer1M: 30.00, cacheReadPer1M: 0.50,  cacheWritePer1M: 0 },
  'gpt-5.4':            { inputPer1M: 2.50,  outputPer1M: 15.00, cacheReadPer1M: 0.25,  cacheWritePer1M: 0 },
  'gpt-5.4-pro':        { inputPer1M: 30.00, outputPer1M: 180.00, cacheReadPer1M: 0,    cacheWritePer1M: 0 },
  'gpt-5.4-mini':       { inputPer1M: 0.75,  outputPer1M: 4.50,  cacheReadPer1M: 0.075, cacheWritePer1M: 0 },
  'gpt-5.3-codex':      { inputPer1M: 1.75,  outputPer1M: 14.00, cacheReadPer1M: 0.175, cacheWritePer1M: 0 },
  'gpt-5.3-chat':       { inputPer1M: 1.75,  outputPer1M: 14.00, cacheReadPer1M: 0.175, cacheWritePer1M: 0 },
  'gpt-5.2-codex':      { inputPer1M: 1.75,  outputPer1M: 14.00, cacheReadPer1M: 0.175, cacheWritePer1M: 0 },
  'gpt-5.2-chat-latest': { inputPer1M: 1.75, outputPer1M: 14.00, cacheReadPer1M: 0.175, cacheWritePer1M: 0 },
  'gpt-5.2':            { inputPer1M: 1.75,  outputPer1M: 14.00, cacheReadPer1M: 0.175, cacheWritePer1M: 0 },
  'gpt-5-codex':        { inputPer1M: 1.25,  outputPer1M: 10.00, cacheReadPer1M: 0.125, cacheWritePer1M: 0 },
  'gpt-5-mini':         { inputPer1M: 0.25,  outputPer1M: 2.00,  cacheReadPer1M: 0.025, cacheWritePer1M: 0 },
  'gpt-5':              { inputPer1M: 1.25,  outputPer1M: 10.00, cacheReadPer1M: 0.125, cacheWritePer1M: 0 },
  'gpt-4o':             { inputPer1M: 2.50,  outputPer1M: 10.00, cacheReadPer1M: 1.25,  cacheWritePer1M: 0 },
  'gpt-4o-mini':        { inputPer1M: 0.15,  outputPer1M: 0.60,  cacheReadPer1M: 0.075, cacheWritePer1M: 0 },
  'o1':                 { inputPer1M: 15.00, outputPer1M: 60.00, cacheReadPer1M: 7.50,  cacheWritePer1M: 0 },
  'o1-mini':            { inputPer1M: 3.00,  outputPer1M: 12.00, cacheReadPer1M: 1.50,  cacheWritePer1M: 0 },
  'o3':                 { inputPer1M: 2.00,  outputPer1M: 8.00,  cacheReadPer1M: 0.50,  cacheWritePer1M: 0 },
  'o3-mini':            { inputPer1M: 1.10,  outputPer1M: 4.40,  cacheReadPer1M: 0.55,  cacheWritePer1M: 0 },
  'o4-mini':            { inputPer1M: 1.10,  outputPer1M: 4.40,  cacheReadPer1M: 0.275, cacheWritePer1M: 0 },

  // Community/provider rows kept for user-configurable non-core tracking.
  'qwen3.6-plus':       { inputPer1M: 0.80,  outputPer1M: 2.00,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'qwen3.6':            { inputPer1M: 0.30,  outputPer1M: 0.60,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'minimax-m2.7':       { inputPer1M: 0.70,  outputPer1M: 0.70,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'minimax-m2.7-highspeed': { inputPer1M: 0.70, outputPer1M: 0.70, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'minimax-m1':         { inputPer1M: 0.20,  outputPer1M: 1.10,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'grok-4.20':          { inputPer1M: 1.25,  outputPer1M: 2.50,  cacheReadPer1M: 0.20, cacheWritePer1M: 0 },
  'grok-4':             { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0.75, cacheWritePer1M: 0 },
  'grok-3':             { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'grok-3-mini':        { inputPer1M: 0.30,  outputPer1M: 0.50,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'glm-5.1':            { inputPer1M: 0.70,  outputPer1M: 0.70,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'glm-5':              { inputPer1M: 0.70,  outputPer1M: 0.70,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'kimi-k2':            { inputPer1M: 0.60,  outputPer1M: 0.60,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
}

const LEGACY_DEFAULT_PRICING: Record<string, ModelPricing> = {
  'claude-3-5-haiku': { inputPer1M: 1.00, outputPer1M: 5.00, cacheReadPer1M: 0.10, cacheWritePer1M: 1.25 },
  'claude-opus-4': { inputPer1M: 5.00, outputPer1M: 25.00, cacheReadPer1M: 0.50, cacheWritePer1M: 6.25 },
  'gemini-3.1-pro': { inputPer1M: 1.25, outputPer1M: 10.00, cacheReadPer1M: 0.31, cacheWritePer1M: 0 },
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10.00, cacheReadPer1M: 0.31, cacheWritePer1M: 0 },
  'gemini-2.5-flash': { inputPer1M: 0.15, outputPer1M: 0.60, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'gemini-2.0-flash': { inputPer1M: 0.075, outputPer1M: 0.30, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'gpt-5-codex': { inputPer1M: 1.75, outputPer1M: 14.00, cacheReadPer1M: 0.44, cacheWritePer1M: 0 },
  'gpt-5-mini': { inputPer1M: 0.30, outputPer1M: 1.20, cacheReadPer1M: 0.075, cacheWritePer1M: 0 },
  'gpt-5.2': { inputPer1M: 2.00, outputPer1M: 8.00, cacheReadPer1M: 0.50, cacheWritePer1M: 0 },
  'gpt-5.3-chat': { inputPer1M: 2.00, outputPer1M: 8.00, cacheReadPer1M: 0.50, cacheWritePer1M: 0 },
  'o3': { inputPer1M: 10.00, outputPer1M: 40.00, cacheReadPer1M: 2.50, cacheWritePer1M: 0 },
}

const ADDITIONAL_LEGACY_DEFAULT_PRICING: Record<string, ModelPricing[]> = {
  'gemini-2.5-pro': [
    { inputPer1M: 1.25, outputPer1M: 10.00, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  ],
}

// Normalize raw model names: strip provider prefixes and date suffixes like -20251101.
export function normalizeModelName(raw: string): string {
  return raw.trim().toLowerCase()
    .replace(/^models\//, '')
    .replace(/^[a-z0-9_.-]+\//, '')
    .replace(/:.+$/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
}

function bestPrefixMatch<T>(normalized: string, entries: Array<[string, T]>): T | null {
  let best: [string, T] | null = null
  for (const entry of entries) {
    const [key] = entry
    if (!normalized.startsWith(key)) continue
    if (!best || key.length > best[0].length) best = entry
  }
  return best?.[1] ?? null
}

// Ensure default prices are seeded into the DB.
export function ensurePricingSeeded(db: Database): void {
  seedModelPricing(db, DEFAULT_PRICING)
  repairLegacySeededPricing(db)
  repairMissingDefaultCacheWrite1h(db)
}

function repairLegacySeededPricing(db: Database): void {
  const now = new Date().toISOString()
  for (const [model, legacy] of Object.entries(LEGACY_DEFAULT_PRICING)) {
    const current = getModelPricing(db, model)
    const next = DEFAULT_PRICING[model]
    if (!current || !next) continue
    const legacyRows = [legacy, ...(ADDITIONAL_LEGACY_DEFAULT_PRICING[model] ?? [])]
    if (!legacyRows.some(row => samePricing(current, row))) continue
    upsertModelPricing(db, {
      model,
      input_per_1m: next.inputPer1M,
      output_per_1m: next.outputPer1M,
      cache_read_per_1m: next.cacheReadPer1M,
      cache_write_per_1m: next.cacheWritePer1M,
      cache_write_1h_per_1m: next.cacheWrite1hPer1M ?? 0,
      updated_at: now,
    })
  }
}

function repairMissingDefaultCacheWrite1h(db: Database): void {
  const now = new Date().toISOString()
  for (const [model, next] of Object.entries(DEFAULT_PRICING)) {
    if (!next.cacheWrite1hPer1M) continue
    const current = getModelPricing(db, model)
    if (!current) continue
    if ((current.cache_write_1h_per_1m ?? 0) !== 0) continue
    if (!sameBasePricing(current, next)) continue
    upsertModelPricing(db, {
      model,
      input_per_1m: current.input_per_1m,
      output_per_1m: current.output_per_1m,
      cache_read_per_1m: current.cache_read_per_1m,
      cache_write_per_1m: current.cache_write_per_1m,
      cache_write_1h_per_1m: next.cacheWrite1hPer1M,
      updated_at: now,
    })
  }
}

function sameBasePricing(row: {
  input_per_1m: number
  output_per_1m: number
  cache_read_per_1m: number
  cache_write_per_1m: number
}, pricing: ModelPricing): boolean {
  return row.input_per_1m === pricing.inputPer1M &&
    row.output_per_1m === pricing.outputPer1M &&
    row.cache_read_per_1m === pricing.cacheReadPer1M &&
    row.cache_write_per_1m === pricing.cacheWritePer1M
}

function samePricing(row: {
  input_per_1m: number
  output_per_1m: number
  cache_read_per_1m: number
  cache_write_per_1m: number
  cache_write_1h_per_1m?: number
}, pricing: ModelPricing): boolean {
  return row.input_per_1m === pricing.inputPer1M &&
    row.output_per_1m === pricing.outputPer1M &&
    row.cache_read_per_1m === pricing.cacheReadPer1M &&
    row.cache_write_per_1m === pricing.cacheWritePer1M &&
    (row.cache_write_1h_per_1m ?? 0) === (pricing.cacheWrite1hPer1M ?? 0)
}

// Look up pricing from DB, fallback to defaults for unknown models.
export function getPricingFromDb(db: Database, model: string): ModelPricing | null {
  const normalized = normalizeModelName(model)

  const row = getModelPricing(db, normalized)
  if (row) {
    const seeded = DEFAULT_PRICING[normalized]
    const cacheWrite1hPer1M = seeded?.cacheWrite1hPer1M &&
      (row.cache_write_1h_per_1m ?? 0) === 0 &&
      sameBasePricing(row, seeded)
      ? seeded.cacheWrite1hPer1M
      : (row.cache_write_1h_per_1m ?? 0)
    return {
      inputPer1M: row.input_per_1m,
      outputPer1M: row.output_per_1m,
      cacheReadPer1M: row.cache_read_per_1m,
      cacheWritePer1M: row.cache_write_per_1m,
      cacheWrite1hPer1M,
    }
  }

  const allRows = db.prepare(`SELECT * FROM model_pricing`).all() as Array<{
    model: string
    input_per_1m: number
    output_per_1m: number
    cache_read_per_1m: number
    cache_write_per_1m: number
    cache_write_1h_per_1m?: number
  }>
  const match = bestPrefixMatch(normalized, allRows.map(r => [r.model, r]))
  if (!match) return null
  const seeded = DEFAULT_PRICING[match.model]
  const cacheWrite1hPer1M = seeded?.cacheWrite1hPer1M &&
    (match.cache_write_1h_per_1m ?? 0) === 0 &&
    sameBasePricing(match, seeded)
    ? seeded.cacheWrite1hPer1M
    : (match.cache_write_1h_per_1m ?? 0)
  return {
    inputPer1M: match.input_per_1m,
    outputPer1M: match.output_per_1m,
    cacheReadPer1M: match.cache_read_per_1m,
    cacheWritePer1M: match.cache_write_per_1m,
    cacheWrite1hPer1M,
  }
}

// Stateless fallback (no DB) - used in tests and SDK.
export function getPricing(model: string): ModelPricing | null {
  const normalized = normalizeModelName(model)
  if (DEFAULT_PRICING[normalized]) return DEFAULT_PRICING[normalized] ?? null
  return bestPrefixMatch(normalized, Object.entries(DEFAULT_PRICING))
}

export function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
  cacheWrite1hTokens = 0,
): number {
  const pricing = getPricing(model)
  if (!pricing) return 0
  return computeCostWithPricing(model, pricing, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cacheWrite1hTokens)
}

export function computeCostFromDb(
  db: Database,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
  cacheWrite1hTokens = 0,
): number {
  const pricing = getPricingFromDb(db, model) ?? getPricing(model)
  if (!pricing) return 0
  return computeCostWithPricing(model, pricing, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cacheWrite1hTokens)
}

function computeCostWithPricing(
  model: string,
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  cacheWrite1hTokens: number,
): number {
  let effective = pricing
  const normalized = normalizeModelName(model)
  if (normalized.startsWith('gemini-2.5-pro')) {
    const billablePromptTokens = inputTokens + cacheReadTokens + cacheWriteTokens + cacheWrite1hTokens
    if (billablePromptTokens > 200_000) {
      effective = {
        ...pricing,
        inputPer1M: 2.50,
        outputPer1M: 15.00,
        cacheReadPer1M: 0.25,
      }
    }
  }

  return (
    inputTokens * effective.inputPer1M +
    outputTokens * effective.outputPer1M +
    cacheReadTokens * effective.cacheReadPer1M +
    cacheWriteTokens * effective.cacheWritePer1M +
    cacheWrite1hTokens * (effective.cacheWrite1hPer1M ?? effective.cacheWritePer1M)
  ) / 1_000_000
}
