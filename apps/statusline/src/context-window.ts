import { existsSync, readFileSync } from "node:fs";
import type { StatusContext } from "./providers/types.js";

export interface ContextUsage {
  /** Tokens currently occupying the context window (input side). */
  used: number;
  /** Output tokens of the latest assistant turn. */
  output: number;
  /** Context window size in tokens. */
  window: number;
}

/**
 * Derive context usage from the session transcript (JSONL). The last
 * assistant entry's usage block reflects what the context window holds.
 */
export function contextUsage(ctx: StatusContext): ContextUsage | null {
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
      const used =
        usage.input_tokens +
        (usage.cache_creation_input_tokens || 0) +
        (usage.cache_read_input_tokens || 0);
      return {
        used,
        output: usage.output_tokens || 0,
        window: windowSize(ctx),
      };
    } catch {
      continue;
    }
  }
  return null;
}

function windowSize(ctx: StatusContext): number {
  return ctx.model?.id?.includes("[1m]") ? 1_000_000 : 200_000;
}
