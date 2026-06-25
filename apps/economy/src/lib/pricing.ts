import type { Database } from '../db/database.js'
import type { ModelPricing } from '../types/index.js'
import { deleteModelPricing, getModelPricing, seedModelPricing, upsertModelPricing } from '../db/database.js'

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
  'claude-haiku-4-5':   { inputPer1M: 1.00,  outputPer1M: 5.00,  cacheReadPer1M: 0.10,  cacheWritePer1M: 1.25,  cacheWrite1hPer1M: 2.00 },
  'claude-3-5-haiku':   { inputPer1M: 0.80,  outputPer1M: 4.00,  cacheReadPer1M: 0.08,  cacheWritePer1M: 1.00,  cacheWrite1hPer1M: 1.60 },
  'claude-3-opus':      { inputPer1M: 15.00, outputPer1M: 75.00, cacheReadPer1M: 1.50,  cacheWritePer1M: 18.75, cacheWrite1hPer1M: 30.00 },
  'claude-3-haiku':     { inputPer1M: 0.25,  outputPer1M: 1.25, cacheReadPer1M: 0.03,  cacheWritePer1M: 0.30,  cacheWrite1hPer1M: 0.50 },

  // Gemini standard text/image/video paid tier rates.
  'gemini-3.1-pro-preview': { inputPer1M: 2.00, outputPer1M: 12.00, cacheReadPer1M: 0.20, cacheWritePer1M: 0, cacheStoragePer1MHour: 4.50 },
  'gemini-3.1-flash-lite-preview': { inputPer1M: 0.25, outputPer1M: 1.50, cacheReadPer1M: 0.025, cacheWritePer1M: 0, cacheStoragePer1MHour: 1.00 },
  'gemini-3.1-flash-lite': { inputPer1M: 0.25, outputPer1M: 1.50, cacheReadPer1M: 0.025, cacheWritePer1M: 0, cacheStoragePer1MHour: 1.00 },
  'gemini-3-flash-preview': { inputPer1M: 0.50, outputPer1M: 3.00, cacheReadPer1M: 0.05, cacheWritePer1M: 0, cacheStoragePer1MHour: 1.00 },
  'gemini-2.5-pro':     { inputPer1M: 1.25,  outputPer1M: 10.00, cacheReadPer1M: 0.125, cacheWritePer1M: 0, cacheStoragePer1MHour: 4.50 },
  'gemini-2.5-flash':   { inputPer1M: 0.30,  outputPer1M: 2.50,  cacheReadPer1M: 0.03,  cacheWritePer1M: 0, cacheStoragePer1MHour: 1.00 },
  'gemini-2.5-flash-lite': { inputPer1M: 0.10, outputPer1M: 0.40, cacheReadPer1M: 0.01, cacheWritePer1M: 0, cacheStoragePer1MHour: 1.00 },
  'gemini-2.0-flash':   { inputPer1M: 0.10,  outputPer1M: 0.40,  cacheReadPer1M: 0.025, cacheWritePer1M: 0, cacheStoragePer1MHour: 1.00 },
  'gemini-2.0-flash-lite': { inputPer1M: 0.075, outputPer1M: 0.30, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'google/gemini-3.1-pro-preview': { inputPer1M: 2.00, outputPer1M: 12.00, cacheReadPer1M: 0.20, cacheWritePer1M: 0.375 },
  'google/gemini-3.1-flash-lite-preview': { inputPer1M: 0.25, outputPer1M: 1.50, cacheReadPer1M: 0.025, cacheWritePer1M: 0.08333333333333334 },
  'google/gemini-3.1-flash-lite': { inputPer1M: 0.25, outputPer1M: 1.50, cacheReadPer1M: 0.025, cacheWritePer1M: 0.08333333333333334 },
  'google/gemini-3-flash-preview': { inputPer1M: 0.50, outputPer1M: 3.00, cacheReadPer1M: 0.05, cacheWritePer1M: 0.08333333333333334 },
  'google/gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10.00, cacheReadPer1M: 0.125, cacheWritePer1M: 0.375 },
  'google/gemini-2.5-flash': { inputPer1M: 0.30, outputPer1M: 2.50, cacheReadPer1M: 0.03, cacheWritePer1M: 0.08333333333333334 },
  'google/gemini-2.5-flash-lite': { inputPer1M: 0.10, outputPer1M: 0.40, cacheReadPer1M: 0.01, cacheWritePer1M: 0.08333333333333334 },

  // OpenAI standard text token rates.
  'gpt-5.5':            { inputPer1M: 5.00,  outputPer1M: 30.00, cacheReadPer1M: 0.50,  cacheWritePer1M: 0 },
  'gpt-5.5-pro':        { inputPer1M: 30.00, outputPer1M: 180.00, cacheReadPer1M: 0,     cacheWritePer1M: 0 },
  'gpt-5.4':            { inputPer1M: 2.50,  outputPer1M: 15.00, cacheReadPer1M: 0.25,  cacheWritePer1M: 0 },
  'gpt-5.4-pro':        { inputPer1M: 30.00, outputPer1M: 180.00, cacheReadPer1M: 0,    cacheWritePer1M: 0 },
  'gpt-5.4-mini':       { inputPer1M: 0.75,  outputPer1M: 4.50,  cacheReadPer1M: 0.075, cacheWritePer1M: 0 },
  'gpt-5.4-nano':       { inputPer1M: 0.20,  outputPer1M: 1.25,  cacheReadPer1M: 0.02,  cacheWritePer1M: 0 },
  'gpt-5.3-codex':      { inputPer1M: 1.75,  outputPer1M: 14.00, cacheReadPer1M: 0.175, cacheWritePer1M: 0 },
  'gpt-5.2-codex':      { inputPer1M: 1.75,  outputPer1M: 14.00, cacheReadPer1M: 0.175, cacheWritePer1M: 0 },
  'gpt-5.2-chat-latest': { inputPer1M: 1.75, outputPer1M: 14.00, cacheReadPer1M: 0.175, cacheWritePer1M: 0 },
  'gpt-5.2':            { inputPer1M: 1.75,  outputPer1M: 14.00, cacheReadPer1M: 0.175, cacheWritePer1M: 0 },
  'gpt-5-codex':        { inputPer1M: 1.25,  outputPer1M: 10.00, cacheReadPer1M: 0.125, cacheWritePer1M: 0 },
  'gpt-5-mini':         { inputPer1M: 0.25,  outputPer1M: 2.00,  cacheReadPer1M: 0.025, cacheWritePer1M: 0 },
  'gpt-5':              { inputPer1M: 1.25,  outputPer1M: 10.00, cacheReadPer1M: 0.125, cacheWritePer1M: 0 },
  'gpt-4o':             { inputPer1M: 2.50,  outputPer1M: 10.00, cacheReadPer1M: 1.25,  cacheWritePer1M: 0 },
  'gpt-4o-mini':        { inputPer1M: 0.15,  outputPer1M: 0.60,  cacheReadPer1M: 0.075, cacheWritePer1M: 0 },
  'o1':                 { inputPer1M: 15.00, outputPer1M: 60.00, cacheReadPer1M: 7.50,  cacheWritePer1M: 0 },
  'o1-mini':            { inputPer1M: 1.10,  outputPer1M: 4.40,  cacheReadPer1M: 0.55,  cacheWritePer1M: 0 },
  'o3':                 { inputPer1M: 2.00,  outputPer1M: 8.00,  cacheReadPer1M: 0.50,  cacheWritePer1M: 0 },
  'o3-mini':            { inputPer1M: 1.10,  outputPer1M: 4.40,  cacheReadPer1M: 0.55,  cacheWritePer1M: 0 },
  'o4-mini':            { inputPer1M: 1.10,  outputPer1M: 4.40,  cacheReadPer1M: 0.275, cacheWritePer1M: 0 },

  // Community/provider rows kept for user-configurable non-core tracking.
  // Provider-qualified rows keep router pricing separate from direct API pricing.
  'qwen3.6-plus':       { inputPer1M: 0.325, outputPer1M: 1.95,  cacheReadPer1M: 0.0325, cacheWritePer1M: 0.40625 },
  'qwen3.6-flash':      { inputPer1M: 0.25,  outputPer1M: 1.50,  cacheReadPer1M: 0.025, cacheWritePer1M: 0.3125 },
  'qwen3.6-35b-a3b':    { inputPer1M: 0.15,  outputPer1M: 1.00,  cacheReadPer1M: 0.05, cacheWritePer1M: 0 },
  'qwen3.6-max-preview': { inputPer1M: 1.04, outputPer1M: 6.24,  cacheReadPer1M: 0.104, cacheWritePer1M: 1.30 },
  'qwen3.6-27b':        { inputPer1M: 0.32,  outputPer1M: 3.20,  cacheReadPer1M: 0,    cacheWritePer1M: 0 },
  'qwen/qwen3.6-plus':  { inputPer1M: 0.325, outputPer1M: 1.95,  cacheReadPer1M: 0.0325, cacheWritePer1M: 0.40625 },
  'qwen/qwen3.6-flash': { inputPer1M: 0.25,  outputPer1M: 1.50,  cacheReadPer1M: 0.025, cacheWritePer1M: 0.3125 },
  'qwen/qwen3.6-35b-a3b': { inputPer1M: 0.15, outputPer1M: 1.00, cacheReadPer1M: 0.05, cacheWritePer1M: 0 },
  'qwen/qwen3.6-max-preview': { inputPer1M: 1.04, outputPer1M: 6.24, cacheReadPer1M: 0.104, cacheWritePer1M: 1.30 },
  'qwen/qwen3.6-27b':   { inputPer1M: 0.32,  outputPer1M: 3.20,  cacheReadPer1M: 0,    cacheWritePer1M: 0 },
  'minimax-m2.7':       { inputPer1M: 0.30,  outputPer1M: 1.20,  cacheReadPer1M: 0.06, cacheWritePer1M: 0.375 },
  'minimax-m2.7-highspeed': { inputPer1M: 0.60, outputPer1M: 2.40, cacheReadPer1M: 0.06, cacheWritePer1M: 0.375 },
  'minimax/minimax-m2.7': { inputPer1M: 0.299, outputPer1M: 1.20, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'minimax-m1':         { inputPer1M: 0.40,  outputPer1M: 2.20,  cacheReadPer1M: 0,    cacheWritePer1M: 0 },
  'minimax/minimax-m1': { inputPer1M: 0.40,  outputPer1M: 2.20,  cacheReadPer1M: 0,    cacheWritePer1M: 0 },
  'grok-4.3':           { inputPer1M: 1.25,  outputPer1M: 2.50,  cacheReadPer1M: 0.20, cacheWritePer1M: 0 },
  'grok-latest':        { inputPer1M: 1.25,  outputPer1M: 2.50,  cacheReadPer1M: 0.20, cacheWritePer1M: 0 },
  'grok-4.20':          { inputPer1M: 1.25,  outputPer1M: 2.50,  cacheReadPer1M: 0.20, cacheWritePer1M: 0 },
  'grok-4-1-fast':      { inputPer1M: 0.20,  outputPer1M: 0.50,  cacheReadPer1M: 0.05, cacheWritePer1M: 0 },
  'grok-4-fast':        { inputPer1M: 0.20,  outputPer1M: 0.50,  cacheReadPer1M: 0.05, cacheWritePer1M: 0 },
  'grok-4':             { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0.75, cacheWritePer1M: 0 },
  'grok-code-fast-1':   { inputPer1M: 0.20,  outputPer1M: 1.50,  cacheReadPer1M: 0.02, cacheWritePer1M: 0 },
  'grok-code-fast':     { inputPer1M: 0.20,  outputPer1M: 1.50,  cacheReadPer1M: 0.02, cacheWritePer1M: 0 },
  'grok-3':             { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0.75, cacheWritePer1M: 0 },
  'grok-3-mini':        { inputPer1M: 0.30,  outputPer1M: 0.50,  cacheReadPer1M: 0.07, cacheWritePer1M: 0 },
  'glm-5.1':            { inputPer1M: 1.40,  outputPer1M: 4.40,  cacheReadPer1M: 0.26,  cacheWritePer1M: 0 },
  'glm-5':              { inputPer1M: 1.00,  outputPer1M: 3.20,  cacheReadPer1M: 0.20,  cacheWritePer1M: 0 },
  'z-ai/glm-5.1':       { inputPer1M: 1.05,  outputPer1M: 3.50,  cacheReadPer1M: 0.525, cacheWritePer1M: 0 },
  'z-ai/glm-5':         { inputPer1M: 0.60,  outputPer1M: 1.92,  cacheReadPer1M: 0.12,  cacheWritePer1M: 0 },
  'kimi-k2.6':          { inputPer1M: 0.95,  outputPer1M: 4.00,  cacheReadPer1M: 0.16, cacheWritePer1M: 0 },
  'kimi-k2.5':          { inputPer1M: 0.60,  outputPer1M: 3.00,  cacheReadPer1M: 0.10, cacheWritePer1M: 0 },
  'kimi-k2':            { inputPer1M: 0.60,  outputPer1M: 2.50,  cacheReadPer1M: 0.15, cacheWritePer1M: 0 },
  'moonshotai/kimi-k2.6': { inputPer1M: 0.75, outputPer1M: 3.50, cacheReadPer1M: 0.15, cacheWritePer1M: 0 },
  'moonshotai/kimi-k2.5': { inputPer1M: 0.44, outputPer1M: 2.00, cacheReadPer1M: 0.22, cacheWritePer1M: 0 },
  'moonshotai/kimi-k2': { inputPer1M: 0.57, outputPer1M: 2.30, cacheReadPer1M: 0, cacheWritePer1M: 0 },
}

const LEGACY_DEFAULT_PRICING: Record<string, ModelPricing> = {
  'claude-3-5-haiku': { inputPer1M: 1.00, outputPer1M: 5.00, cacheReadPer1M: 0.10, cacheWritePer1M: 1.25 },
  'claude-opus-4': { inputPer1M: 5.00, outputPer1M: 25.00, cacheReadPer1M: 0.50, cacheWritePer1M: 6.25 },
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10.00, cacheReadPer1M: 0.31, cacheWritePer1M: 0 },
  'gemini-2.5-flash': { inputPer1M: 0.15, outputPer1M: 0.60, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'gemini-2.0-flash': { inputPer1M: 0.075, outputPer1M: 0.30, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'gpt-5.3-codex': { inputPer1M: 1.75, outputPer1M: 14.00, cacheReadPer1M: 0.44, cacheWritePer1M: 0 },
  'gpt-5.2-codex': { inputPer1M: 1.75, outputPer1M: 14.00, cacheReadPer1M: 0.44, cacheWritePer1M: 0 },
  'gpt-5-codex': { inputPer1M: 1.75, outputPer1M: 14.00, cacheReadPer1M: 0.44, cacheWritePer1M: 0 },
  'gpt-5-mini': { inputPer1M: 0.30, outputPer1M: 1.20, cacheReadPer1M: 0.075, cacheWritePer1M: 0 },
  'gpt-5.2': { inputPer1M: 2.00, outputPer1M: 8.00, cacheReadPer1M: 0.50, cacheWritePer1M: 0 },
  'o1-mini': { inputPer1M: 3.00, outputPer1M: 12.00, cacheReadPer1M: 1.50, cacheWritePer1M: 0 },
  'grok-3': { inputPer1M: 3.00, outputPer1M: 15.00, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'grok-3-mini': { inputPer1M: 0.30, outputPer1M: 0.50, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'qwen3.6-plus': { inputPer1M: 0.80, outputPer1M: 2.00, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'minimax-m2.7': { inputPer1M: 0.70, outputPer1M: 0.70, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'minimax-m2.7-highspeed': { inputPer1M: 0.70, outputPer1M: 0.70, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'minimax-m1': { inputPer1M: 0.20, outputPer1M: 1.10, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'glm-5.1': { inputPer1M: 0.70, outputPer1M: 0.70, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'glm-5': { inputPer1M: 0.70, outputPer1M: 0.70, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'kimi-k2': { inputPer1M: 0.60, outputPer1M: 0.60, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  'o3': { inputPer1M: 10.00, outputPer1M: 40.00, cacheReadPer1M: 2.50, cacheWritePer1M: 0 },
}

const ADDITIONAL_LEGACY_DEFAULT_PRICING: Record<string, ModelPricing[]> = {
  'gemini-2.5-pro': [
    { inputPer1M: 1.25, outputPer1M: 10.00, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  ],
  'qwen3.6-plus': [
    { inputPer1M: 0.325, outputPer1M: 1.95, cacheReadPer1M: 0, cacheWritePer1M: 0.40625 },
    { inputPer1M: 0.325, outputPer1M: 1.95, cacheReadPer1M: 0.05, cacheWritePer1M: 0.40625 },
  ],
  'qwen3.6-flash': [
    { inputPer1M: 0.25, outputPer1M: 1.50, cacheReadPer1M: 0, cacheWritePer1M: 0.3125 },
  ],
  'qwen3.6-max-preview': [
    { inputPer1M: 1.04, outputPer1M: 6.24, cacheReadPer1M: 0, cacheWritePer1M: 1.30 },
    { inputPer1M: 1.04, outputPer1M: 6.24, cacheReadPer1M: 0.13, cacheWritePer1M: 1.30 },
  ],
  'qwen/qwen3.6-plus': [
    { inputPer1M: 0.325, outputPer1M: 1.95, cacheReadPer1M: 0, cacheWritePer1M: 0.40625 },
    { inputPer1M: 0.325, outputPer1M: 1.95, cacheReadPer1M: 0.05, cacheWritePer1M: 0.40625 },
  ],
  'qwen/qwen3.6-flash': [
    { inputPer1M: 0.25, outputPer1M: 1.50, cacheReadPer1M: 0, cacheWritePer1M: 0.3125 },
  ],
  'qwen/qwen3.6-max-preview': [
    { inputPer1M: 1.04, outputPer1M: 6.24, cacheReadPer1M: 0, cacheWritePer1M: 1.30 },
    { inputPer1M: 1.04, outputPer1M: 6.24, cacheReadPer1M: 0.13, cacheWritePer1M: 1.30 },
  ],
}

const REMOVED_DEFAULT_PRICING: Record<string, ModelPricing[]> = {
  'claude-3-5-sonnet': [
    { inputPer1M: 3.00, outputPer1M: 15.00, cacheReadPer1M: 0.30, cacheWritePer1M: 3.75, cacheWrite1hPer1M: 6.00 },
    { inputPer1M: 3.00, outputPer1M: 15.00, cacheReadPer1M: 0.30, cacheWritePer1M: 3.75, cacheWrite1hPer1M: 0 },
  ],
  'claude-3-sonnet': [
    { inputPer1M: 3.00, outputPer1M: 15.00, cacheReadPer1M: 0.30, cacheWritePer1M: 3.75, cacheWrite1hPer1M: 6.00 },
    { inputPer1M: 3.00, outputPer1M: 15.00, cacheReadPer1M: 0.30, cacheWritePer1M: 3.75, cacheWrite1hPer1M: 0 },
  ],
  'gemini-3.1-pro': [
    { inputPer1M: 2.00, outputPer1M: 12.00, cacheReadPer1M: 0.20, cacheWritePer1M: 0 },
    { inputPer1M: 1.25, outputPer1M: 10.00, cacheReadPer1M: 0.31, cacheWritePer1M: 0 },
  ],
  'gemini-1.5-pro': [
    { inputPer1M: 1.25, outputPer1M: 5.00, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  ],
  'gemini-1.5-flash': [
    { inputPer1M: 0.075, outputPer1M: 0.30, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  ],
  'gpt-5.3-chat': [
    { inputPer1M: 1.75, outputPer1M: 14.00, cacheReadPer1M: 0.175, cacheWritePer1M: 0 },
    { inputPer1M: 2.00, outputPer1M: 8.00, cacheReadPer1M: 0.50, cacheWritePer1M: 0 },
  ],
  'qwen3.6': [
    { inputPer1M: 0.30, outputPer1M: 0.60, cacheReadPer1M: 0, cacheWritePer1M: 0 },
  ],
}

interface PromptTier {
  threshold: number
  inputPer1M?: number
  outputPer1M?: number
  cacheReadPer1M?: number
  cacheWritePer1M?: number
  inputMultiplier?: number
  outputMultiplier?: number
  cacheReadMultiplier?: number
  cacheWriteMultiplier?: number
}

const FREE_PRICING: ModelPricing = {
  inputPer1M: 0,
  outputPer1M: 0,
  cacheReadPer1M: 0,
  cacheWritePer1M: 0,
  cacheWrite1hPer1M: 0,
  cacheStoragePer1MHour: 0,
}

const GEMINI_PROMPT_TIERS: Record<string, PromptTier> = {
  'gemini-3.1-pro-preview': {
    threshold: 200_000,
    inputPer1M: 4.00,
    outputPer1M: 18.00,
    cacheReadPer1M: 0.40,
  },
  'gemini-2.5-pro': {
    threshold: 200_000,
    inputPer1M: 2.50,
    outputPer1M: 15.00,
    cacheReadPer1M: 0.25,
  },
}

const OPENAI_PROMPT_TIERS: Record<string, PromptTier> = {
  'gpt-5.5': {
    threshold: 272_000,
    inputMultiplier: 2,
    outputMultiplier: 1.5,
    cacheReadMultiplier: 2,
  },
  'gpt-5.4-pro': {
    threshold: 272_000,
    inputMultiplier: 2,
    outputMultiplier: 1.5,
    cacheReadMultiplier: 2,
  },
  'gpt-5.4': {
    threshold: 272_000,
    inputMultiplier: 2,
    outputMultiplier: 1.5,
    cacheReadMultiplier: 2,
  },
}

const QWEN_PROMPT_TIERS: Record<string, PromptTier> = {
  'qwen3.6-plus': {
    threshold: 256_000,
    inputPer1M: 1.30,
    outputPer1M: 3.90,
    cacheReadPer1M: 0.13,
    cacheWritePer1M: 1.625,
  },
  'qwen3.6-flash': {
    threshold: 256_000,
    inputPer1M: 1.00,
    outputPer1M: 4.00,
    cacheReadPer1M: 0.10,
    cacheWritePer1M: 1.25,
  },
  'qwen3.6-max-preview': {
    threshold: 128_000,
    inputPer1M: 1.60,
    outputPer1M: 9.60,
    cacheReadPer1M: 0.16,
    cacheWritePer1M: 2.00,
  },
}

const MINIMAX_PROMPT_TIERS: Record<string, PromptTier> = {
  'minimax/minimax-m1': {
    threshold: Number.POSITIVE_INFINITY,
  },
  'minimax-m1': {
    threshold: 200_000,
    inputPer1M: 1.30,
  },
}

const XAI_PROMPT_TIERS: Record<string, PromptTier> = {
  'grok-4.3': {
    threshold: 200_000,
    inputPer1M: 2.50,
    outputPer1M: 5.00,
    cacheReadPer1M: 0.40,
  },
  'grok-latest': {
    threshold: 200_000,
    inputPer1M: 2.50,
    outputPer1M: 5.00,
    cacheReadPer1M: 0.40,
  },
  'grok-4.20': {
    threshold: 200_000,
    inputPer1M: 2.50,
    outputPer1M: 5.00,
    cacheReadPer1M: 0.40,
  },
  'grok-4-1-fast': {
    threshold: 128_000,
    inputPer1M: 0.40,
    outputPer1M: 1.00,
    cacheReadPer1M: 0,
  },
  'grok-4-fast': {
    threshold: 128_000,
    inputPer1M: 0.40,
    outputPer1M: 1.00,
    cacheReadPer1M: 0,
  },
  'grok-4': {
    threshold: 128_000,
    inputPer1M: 6.00,
    outputPer1M: 30.00,
    cacheReadPer1M: 0,
  },
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

function normalizeModelNamePreservingProvider(raw: string): string {
  return raw.trim().toLowerCase()
    .replace(/^models\//, '')
    .replace(/:.+$/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
}

function modelLookupKeys(raw: string): string[] {
  const withProvider = normalizeModelNamePreservingProvider(raw)
  const withoutProvider = normalizeModelName(raw)
  return withProvider === withoutProvider ? [withoutProvider] : [withProvider, withoutProvider]
}

function bestPrefixMatch<T>(normalized: string, entries: Array<[string, T]>): T | null {
  let best: [string, T] | null = null
  for (const entry of entries) {
    const [key] = entry
    if (normalized !== key && !normalized.startsWith(`${key}-`)) continue
    if (!best || key.length > best[0].length) best = entry
  }
  return best?.[1] ?? null
}

function bestModelMatch<T>(model: string, entries: Array<[string, T]>): T | null {
  for (const key of modelLookupKeys(model)) {
    const match = bestPrefixMatch(key, entries)
    if (match) return match
  }
  return null
}

function exactModelMatch<T>(model: string, entries: Array<[string, T]>): T | null {
  for (const key of modelLookupKeys(model)) {
    const match = entries.find(([entryKey]) => entryKey === key)
    if (match) return match[1]
  }
  return null
}

// Ensure default prices are seeded into the DB.
export function ensurePricingSeeded(db: Database): void {
  seedModelPricing(db, DEFAULT_PRICING)
  repairLegacySeededPricing(db)
  repairMissingDefaultCacheWrite1h(db)
  repairMissingDefaultCacheStorage(db)
  removeDeprecatedDefaultPricing(db)
}

function repairLegacySeededPricing(db: Database): void {
  const now = new Date().toISOString()
  const legacyModels = new Set([
    ...Object.keys(LEGACY_DEFAULT_PRICING),
    ...Object.keys(ADDITIONAL_LEGACY_DEFAULT_PRICING),
  ])
  for (const model of legacyModels) {
    const current = getModelPricing(db, model)
    const next = DEFAULT_PRICING[model]
    if (!current || !next) continue
    const legacy = LEGACY_DEFAULT_PRICING[model]
    const legacyRows = [
      ...(legacy ? [legacy] : []),
      ...(ADDITIONAL_LEGACY_DEFAULT_PRICING[model] ?? []),
    ]
    if (!legacyRows.some(row => samePricing(current, row))) continue
    upsertModelPricing(db, {
      model,
      input_per_1m: next.inputPer1M,
      output_per_1m: next.outputPer1M,
      cache_read_per_1m: next.cacheReadPer1M,
      cache_write_per_1m: next.cacheWritePer1M,
      cache_write_1h_per_1m: next.cacheWrite1hPer1M ?? 0,
      cache_storage_per_1m_hour: next.cacheStoragePer1MHour ?? 0,
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
      cache_storage_per_1m_hour: current.cache_storage_per_1m_hour ?? next.cacheStoragePer1MHour ?? 0,
      updated_at: now,
    })
  }
}

function repairMissingDefaultCacheStorage(db: Database): void {
  const now = new Date().toISOString()
  for (const [model, next] of Object.entries(DEFAULT_PRICING)) {
    if (!next.cacheStoragePer1MHour) continue
    const current = getModelPricing(db, model)
    if (!current) continue
    if ((current.cache_storage_per_1m_hour ?? 0) !== 0) continue
    if (!sameBasePricing(current, next)) continue
    upsertModelPricing(db, {
      model,
      input_per_1m: current.input_per_1m,
      output_per_1m: current.output_per_1m,
      cache_read_per_1m: current.cache_read_per_1m,
      cache_write_per_1m: current.cache_write_per_1m,
      cache_write_1h_per_1m: current.cache_write_1h_per_1m ?? next.cacheWrite1hPer1M ?? 0,
      cache_storage_per_1m_hour: next.cacheStoragePer1MHour,
      updated_at: now,
    })
  }
}

function removeDeprecatedDefaultPricing(db: Database): void {
  for (const [model, removedRows] of Object.entries(REMOVED_DEFAULT_PRICING)) {
    const current = getModelPricing(db, model)
    if (!current) continue
    if (!removedRows.some(row => samePricing(current, row))) continue
    deleteModelPricing(db, model)
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
  cache_storage_per_1m_hour?: number
}, pricing: ModelPricing): boolean {
  return row.input_per_1m === pricing.inputPer1M &&
    row.output_per_1m === pricing.outputPer1M &&
    row.cache_read_per_1m === pricing.cacheReadPer1M &&
    row.cache_write_per_1m === pricing.cacheWritePer1M &&
    (row.cache_write_1h_per_1m ?? 0) === (pricing.cacheWrite1hPer1M ?? 0) &&
    (row.cache_storage_per_1m_hour ?? 0) === (pricing.cacheStoragePer1MHour ?? 0)
}

// Look up pricing from DB, fallback to defaults for unknown models.
export function getPricingFromDb(db: Database, model: string): ModelPricing | null {
  if (isFreeModel(model)) return FREE_PRICING

  for (const key of modelLookupKeys(model)) {
    const row = getModelPricing(db, key)
    if (row) return modelPricingFromDbRow(row)
  }

  const allRows = db.prepare(`SELECT * FROM model_pricing`).all() as Array<{
    model: string
    input_per_1m: number
    output_per_1m: number
    cache_read_per_1m: number
    cache_write_per_1m: number
    cache_write_1h_per_1m?: number
    cache_storage_per_1m_hour?: number
  }>
  const match = bestModelMatch(model, allRows.map(r => [r.model, r]))
  if (!match) return null
  return modelPricingFromDbRow(match)
}

function modelPricingFromDbRow(row: {
  model: string
  input_per_1m: number
  output_per_1m: number
  cache_read_per_1m: number
  cache_write_per_1m: number
  cache_write_1h_per_1m?: number
  cache_storage_per_1m_hour?: number
}): ModelPricing {
  const seeded = DEFAULT_PRICING[row.model]
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
    cacheStoragePer1MHour: row.cache_storage_per_1m_hour ?? seeded?.cacheStoragePer1MHour ?? 0,
  }
}

// Stateless fallback (no DB) - used in tests and SDK.
export function getPricing(model: string): ModelPricing | null {
  if (isFreeModel(model)) return FREE_PRICING
  return bestModelMatch(model, Object.entries(DEFAULT_PRICING))
}

function isFreeModel(model: string): boolean {
  return model.trim().toLowerCase().endsWith(':free')
}

export function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
  cacheWrite1hTokens = 0,
  cacheStorageTokenHours = 0,
): number {
  const pricing = getPricing(model)
  if (!pricing) return 0
  return computeCostWithPricing(model, pricing, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cacheWrite1hTokens, cacheStorageTokenHours)
}

export function computeCostFromDb(
  db: Database,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
  cacheWrite1hTokens = 0,
  cacheStorageTokenHours = 0,
): number {
  const pricing = getPricingFromDb(db, model) ?? getPricing(model)
  if (!pricing) return 0
  return computeCostWithPricing(model, pricing, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cacheWrite1hTokens, cacheStorageTokenHours)
}

function computeCostWithPricing(
  model: string,
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  cacheWrite1hTokens: number,
  cacheStorageTokenHours: number,
): number {
  if (isFreeModel(model)) return 0

  let effective = pricing
  const promptTier = bestModelMatch(model, Object.entries(GEMINI_PROMPT_TIERS)) ??
    bestModelMatch(model, Object.entries(QWEN_PROMPT_TIERS)) ??
    bestModelMatch(model, Object.entries(MINIMAX_PROMPT_TIERS)) ??
    bestModelMatch(model, Object.entries(XAI_PROMPT_TIERS)) ??
    exactModelMatch(model, Object.entries(OPENAI_PROMPT_TIERS))
  if (promptTier) {
    const billablePromptTokens = inputTokens + cacheReadTokens + cacheWriteTokens + cacheWrite1hTokens
    if (billablePromptTokens > promptTier.threshold) {
      effective = {
        ...pricing,
        inputPer1M: promptTier.inputPer1M ?? pricing.inputPer1M * (promptTier.inputMultiplier ?? 1),
        outputPer1M: promptTier.outputPer1M ?? pricing.outputPer1M * (promptTier.outputMultiplier ?? 1),
        cacheReadPer1M: promptTier.cacheReadPer1M ?? pricing.cacheReadPer1M * (promptTier.cacheReadMultiplier ?? 1),
        cacheWritePer1M: promptTier.cacheWritePer1M ?? pricing.cacheWritePer1M * (promptTier.cacheWriteMultiplier ?? 1),
      }
    }
  }

  return (
    inputTokens * effective.inputPer1M +
    outputTokens * effective.outputPer1M +
    cacheReadTokens * effective.cacheReadPer1M +
    cacheWriteTokens * effective.cacheWritePer1M +
    cacheWrite1hTokens * (effective.cacheWrite1hPer1M ?? effective.cacheWritePer1M) +
    cacheStorageTokenHours * (effective.cacheStoragePer1MHour ?? 0)
  ) / 1_000_000
}
