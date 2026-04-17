import type { SqliteAdapter as Database } from '@hasna/cloud'
import type { ModelPricing } from '../types/index.js'
import { getModelPricing, seedModelPricing } from '../db/database.js'

// Default pricing seed data (USD per 1M tokens).
// These are written to SQLite on first run and can be edited via `economy pricing set`.
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // Claude 4.x
  'claude-opus-4-7':    { inputPer1M: 5.00,  outputPer1M: 25.00, cacheReadPer1M: 0.50,  cacheWritePer1M: 6.25  },
  'claude-opus-4-6':    { inputPer1M: 5.00,  outputPer1M: 25.00, cacheReadPer1M: 0.50,  cacheWritePer1M: 6.25  },
  'claude-opus-4-5':    { inputPer1M: 5.00,  outputPer1M: 25.00, cacheReadPer1M: 0.50,  cacheWritePer1M: 6.25  },
  'claude-sonnet-4-6':  { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0.30,  cacheWritePer1M: 3.75  },
  'claude-sonnet-4-5':  { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0.30,  cacheWritePer1M: 3.75  },
  'claude-haiku-4-5':   { inputPer1M: 1.00,  outputPer1M: 5.00,  cacheReadPer1M: 0.10,  cacheWritePer1M: 1.25  },
  // Claude 3.x
  'claude-3-5-sonnet':  { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0.30,  cacheWritePer1M: 3.75  },
  'claude-3-5-haiku':   { inputPer1M: 1.00,  outputPer1M: 5.00,  cacheReadPer1M: 0.10,  cacheWritePer1M: 1.25  },
  'claude-3-opus':      { inputPer1M: 15.00, outputPer1M: 75.00, cacheReadPer1M: 1.50,  cacheWritePer1M: 18.75 },
  'claude-3-sonnet':    { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0.30,  cacheWritePer1M: 3.75  },
  'claude-3-haiku':     { inputPer1M: 0.25,  outputPer1M: 1.25,  cacheReadPer1M: 0.03,  cacheWritePer1M: 0.30  },
  // Gemini
  'gemini-3.1-pro':     { inputPer1M: 1.25,   outputPer1M: 10.00, cacheReadPer1M: 0.31, cacheWritePer1M: 0 },
  'gemini-2.5-pro':     { inputPer1M: 1.25,   outputPer1M: 10.00, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'gemini-2.5-flash':   { inputPer1M: 0.15,   outputPer1M: 0.60,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'gemini-2.0-flash':   { inputPer1M: 0.075,  outputPer1M: 0.30,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'gemini-1.5-pro':     { inputPer1M: 1.25,   outputPer1M: 5.00,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'gemini-1.5-flash':   { inputPer1M: 0.075,  outputPer1M: 0.30,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  // OpenAI
  'gpt-5.4':            { inputPer1M: 2.50,  outputPer1M: 10.00, cacheReadPer1M: 0.625, cacheWritePer1M: 0 },
  'gpt-5.4-pro':        { inputPer1M: 5.00,  outputPer1M: 20.00, cacheReadPer1M: 1.25,  cacheWritePer1M: 0 },
  'gpt-5.4-mini':       { inputPer1M: 0.30,  outputPer1M: 1.20,  cacheReadPer1M: 0.075, cacheWritePer1M: 0 },
  'gpt-5.3-codex':      { inputPer1M: 1.75,  outputPer1M: 14.00, cacheReadPer1M: 0.44, cacheWritePer1M: 0 },
  'gpt-5.3-chat':       { inputPer1M: 2.00,  outputPer1M: 8.00,  cacheReadPer1M: 0.50, cacheWritePer1M: 0 },
  'gpt-5.2-codex':      { inputPer1M: 1.75,  outputPer1M: 14.00, cacheReadPer1M: 0.44, cacheWritePer1M: 0 },
  'gpt-5-codex':        { inputPer1M: 1.75,  outputPer1M: 14.00, cacheReadPer1M: 0.44, cacheWritePer1M: 0 },
  'gpt-5-mini':         { inputPer1M: 0.30,  outputPer1M: 1.20,  cacheReadPer1M: 0.075, cacheWritePer1M: 0 },
  'gpt-5.2':            { inputPer1M: 2.00,  outputPer1M: 8.00,  cacheReadPer1M: 0.50, cacheWritePer1M: 0 },
  'gpt-4o':             { inputPer1M: 2.50,  outputPer1M: 10.00, cacheReadPer1M: 1.25,  cacheWritePer1M: 0 },
  'gpt-4o-mini':        { inputPer1M: 0.15,  outputPer1M: 0.60,  cacheReadPer1M: 0.075, cacheWritePer1M: 0 },
  'o1':                 { inputPer1M: 15.00, outputPer1M: 60.00, cacheReadPer1M: 7.50,  cacheWritePer1M: 0 },
  'o1-mini':            { inputPer1M: 3.00,  outputPer1M: 12.00, cacheReadPer1M: 1.50,  cacheWritePer1M: 0 },
  'o3':                 { inputPer1M: 10.00, outputPer1M: 40.00, cacheReadPer1M: 2.50,  cacheWritePer1M: 0 },
  'o3-mini':            { inputPer1M: 1.10,  outputPer1M: 4.40,  cacheReadPer1M: 0.55,  cacheWritePer1M: 0 },
  'o4-mini':            { inputPer1M: 1.10,  outputPer1M: 4.40,  cacheReadPer1M: 0.275, cacheWritePer1M: 0 },
  // Alibaba Qwen
  'qwen3.6-plus':       { inputPer1M: 0.80,  outputPer1M: 2.00,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'qwen3.6':            { inputPer1M: 0.30,  outputPer1M: 0.60,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  // MiniMax
  'minimax-m2.7':           { inputPer1M: 0.70,  outputPer1M: 0.70,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'minimax-m2.7-highspeed': { inputPer1M: 0.70,  outputPer1M: 0.70,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'minimax-m1':             { inputPer1M: 0.20,  outputPer1M: 1.10,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  // xAI Grok
  'grok-3':             { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'grok-3-mini':        { inputPer1M: 0.30,  outputPer1M: 0.50,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  // Zhipu GLM
  'glm-5.1':            { inputPer1M: 0.70,  outputPer1M: 0.70,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'glm-5':              { inputPer1M: 0.70,  outputPer1M: 0.70,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
  // Moonshot Kimi
  'kimi-k2':            { inputPer1M: 0.60,  outputPer1M: 0.60,  cacheReadPer1M: 0, cacheWritePer1M: 0 },
}

// Normalize raw model names: strip date suffixes like -20251101
export function normalizeModelName(raw: string): string {
  return raw
    .replace(/-\d{8}$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
    .toLowerCase()
}

// Ensure default prices are seeded into the DB (no-op if already seeded)
export function ensurePricingSeeded(db: Database): void {
  seedModelPricing(db, DEFAULT_PRICING)
}

// Look up pricing from DB, fallback to defaults for unknown models
export function getPricingFromDb(db: Database, model: string): ModelPricing | null {
  const normalized = normalizeModelName(model)

  // Direct match in DB
  const row = getModelPricing(db, normalized)
  if (row) {
    return {
      inputPer1M: row.input_per_1m,
      outputPer1M: row.output_per_1m,
      cacheReadPer1M: row.cache_read_per_1m,
      cacheWritePer1M: row.cache_write_per_1m,
    }
  }

  // Prefix match in DB
  const allRows = db.prepare(`SELECT * FROM model_pricing`).all() as Array<{ model: string; input_per_1m: number; output_per_1m: number; cache_read_per_1m: number; cache_write_per_1m: number }>
  for (const r of allRows) {
    if (normalized.startsWith(r.model)) {
      return { inputPer1M: r.input_per_1m, outputPer1M: r.output_per_1m, cacheReadPer1M: r.cache_read_per_1m, cacheWritePer1M: r.cache_write_per_1m }
    }
  }

  return null
}

// Stateless fallback (no DB) — used in tests and SDK
export function getPricing(model: string): ModelPricing | null {
  const normalized = normalizeModelName(model)
  if (DEFAULT_PRICING[normalized]) return DEFAULT_PRICING[normalized] ?? null
  for (const key of Object.keys(DEFAULT_PRICING)) {
    if (normalized.startsWith(key)) return DEFAULT_PRICING[key] ?? null
  }
  return null
}

export function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  const pricing = getPricing(model)
  if (!pricing) return 0
  return (
    inputTokens * pricing.inputPer1M +
    outputTokens * pricing.outputPer1M +
    cacheReadTokens * pricing.cacheReadPer1M +
    cacheWriteTokens * pricing.cacheWritePer1M
  ) / 1_000_000
}

export function computeCostFromDb(
  db: Database,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  const pricing = getPricingFromDb(db, model) ?? getPricing(model)
  if (!pricing) return 0
  return (
    inputTokens * pricing.inputPer1M +
    outputTokens * pricing.outputPer1M +
    cacheReadTokens * pricing.cacheReadPer1M +
    cacheWriteTokens * pricing.cacheWritePer1M
  ) / 1_000_000
}
