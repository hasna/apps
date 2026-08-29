import { existsSync, readFileSync } from "node:fs";
import type { StatusContext } from "./providers/types.js";
import { codexCacheRate } from "./providers/codex.js";
import { opencodeCacheRate } from "./providers/opencode.js";

export interface ContextUsage {
  /** Tokens currently occupying the context window (input side). */
  used: number;
  /** Output tokens of the latest assistant turn. */
  output: number;
  /** Context window size in tokens. */
  window: number;
}

/** The raw `message.usage` object of the last assistant entry that carries one. */
export interface UsageBlock {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

/**
 * Scan the session transcript (JSONL) from the end and return the raw usage
 * block of the last assistant entry that carries one — the block that
 * reflects what the context window currently holds. Lines that are malformed
 * or whose usage block lacks a numeric `input_tokens` are skipped, exactly
 * like `contextUsage` used to skip them inline.
 */
export function lastUsageBlock(ctx: StatusContext): UsageBlock | null {
  const path = ctx.transcriptPath;
  if (!path || !existsSync(path)) return null;
  let lines: string[];
  try {
    lines = readFileSync(path, "utf8").split("\n");
  } catch {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('"usage"')) continue;
    try {
      const entry = JSON.parse(line);
      const usage = entry?.message?.usage;
      if (!usage || typeof usage.input_tokens !== "number") continue;
      return usage as UsageBlock;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Derive context usage from the session transcript (JSONL). The last
 * assistant entry's usage block reflects what the context window holds.
 */
export function contextUsage(ctx: StatusContext): ContextUsage | null {
  const usage = lastUsageBlock(ctx);
  if (!usage) return null;
  const used =
    usage.input_tokens +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);
  return {
    used,
    output: usage.output_tokens || 0,
    window: windowSize(ctx),
  };
}

/**
 * Fraction of input-side tokens served from cache, dispatched on the
 * context's provider: the Claude transcript usage block, the Codex session
 * rollout's latest token_count, or the OpenCode sessions DB. Null when the
 * source is absent or the divisor is zero — never a wrong number.
 */
export function cacheRate(ctx: StatusContext): number | null {
  if (ctx.provider === "codex") return codexCacheRate();
  if (ctx.provider === "opencode") return opencodeCacheRate();
  const usage = lastUsageBlock(ctx);
  if (!usage) return null;
  const read = usage.cache_read_input_tokens || 0;
  const creation = usage.cache_creation_input_tokens || 0;
  const input = usage.input_tokens || 0;
  const divisor = input + creation + read;
  if (divisor <= 0) return null;
  return read / divisor;
}

function windowSize(ctx: StatusContext): number {
  return ctx.model?.id?.includes("[1m]") ? 1_000_000 : 200_000;
}
