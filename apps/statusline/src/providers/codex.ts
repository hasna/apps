import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The cumulative token usage Codex reports on its `token_count` events. */
export interface TotalTokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
}

/**
 * Newest `rollout-*.jsonl` under `~/.codex/sessions/YYYY/MM/DD/` — the
 * session with the latest activity, by file mtime. Null when nothing exists
 * or the tree cannot be read (statusline degrade rule: never throw).
 */
export function latestCodexSessionPath(home = homedir()): string | null {
  const root = join(home, ".codex", "sessions");
  if (!existsSync(root)) return null;
  let newest: string | null = null;
  let newestMtime = 0;
  try {
    for (const year of readdirSync(root)) {
      const yearDir = join(root, year);
      if (!statSync(yearDir, { throwIfNoEntry: false })?.isDirectory()) continue;
      for (const month of readdirSync(yearDir)) {
        const monthDir = join(yearDir, month);
        if (!statSync(monthDir, { throwIfNoEntry: false })?.isDirectory()) continue;
        for (const day of readdirSync(monthDir)) {
          const dayDir = join(monthDir, day);
          if (!statSync(dayDir, { throwIfNoEntry: false })?.isDirectory()) continue;
          for (const file of readdirSync(dayDir)) {
            if (!file.startsWith("rollout-") || !file.endsWith(".jsonl")) continue;
            const full = join(dayDir, file);
            const mtime = statSync(full, { throwIfNoEntry: false })?.mtimeMs ?? 0;
            if (mtime > newestMtime) {
              newestMtime = mtime;
              newest = full;
            }
          }
        }
      }
    }
  } catch {
    return null;
  }
  return newest;
}

/**
 * Cache-hit fraction of the newest Codex session: the LAST `event_msg` whose
 * payload is a `token_count`, whose `payload.info.total_token_usage` holds
 * cumulative session totals. Clamped to [0, 1]; null when the file is
 * missing or unreadable, no token_count event exists, or the divisor is 0.
 */
export function codexCacheRate(sessionPath?: string): number | null {
  const path = sessionPath ?? latestCodexSessionPath();
  if (!path || !existsSync(path)) return null;
  let lines: string[];
  try {
    lines = readFileSync(path, "utf8").split("\n");
  } catch {
    return null;
  }
  let usage: TotalTokenUsage | null = null;
  for (const line of lines) {
    if (!line || !line.includes("token_count")) continue;
    try {
      const entry = JSON.parse(line);
      if (entry?.type !== "event_msg") continue;
      if (entry?.payload?.type !== "token_count") continue;
      const info = entry?.payload?.info?.total_token_usage;
      if (info && typeof info === "object") usage = info;
    } catch {
      // malformed lines are skipped, like the transcript scan
      continue;
    }
  }
  if (!usage) return null;
  const read = usage.cached_input_tokens || 0;
  const input = usage.input_tokens || 0;
  const write = usage.cache_write_input_tokens || 0;
  const divisor = input + read + write;
  if (divisor <= 0) return null;
  return Math.min(1, Math.max(0, read / divisor));
}
