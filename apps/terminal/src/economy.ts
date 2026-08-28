// Token economy tracker — tracks token savings across all interactions

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getTerminalDir } from "./paths.js";

const DIR = getTerminalDir();
const ECONOMY_FILE = join(DIR, "economy.json");

export interface EconomyStats {
  totalTokensSaved: number;
  totalTokensUsed: number;
  savingsByFeature: {
    structured: number;
    compressed: number;
    diff: number;
    cache: number;
    search: number;
  };
  sessionStart: number;
  sessionSaved: number;
  sessionUsed: number;
}

let stats: EconomyStats | null = null;

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

function loadStats(): EconomyStats {
  if (stats) return stats;
  ensureDir();
  if (existsSync(ECONOMY_FILE)) {
    try {
      const saved = JSON.parse(readFileSync(ECONOMY_FILE, "utf8"));
      stats = {
        totalTokensSaved: saved.totalTokensSaved ?? 0,
        totalTokensUsed: saved.totalTokensUsed ?? 0,
        savingsByFeature: {
          structured: saved.savingsByFeature?.structured ?? 0,
          compressed: saved.savingsByFeature?.compressed ?? 0,
          diff: saved.savingsByFeature?.diff ?? 0,
          cache: saved.savingsByFeature?.cache ?? 0,
          search: saved.savingsByFeature?.search ?? 0,
        },
        sessionStart: Date.now(),
        sessionSaved: 0,
        sessionUsed: 0,
      };
      return stats;
    } catch {}
  }
  stats = {
    totalTokensSaved: 0,
    totalTokensUsed: 0,
    savingsByFeature: { structured: 0, compressed: 0, diff: 0, cache: 0, search: 0 },
    sessionStart: Date.now(),
    sessionSaved: 0,
    sessionUsed: 0,
  };
  return stats;
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null;

function saveStats() {
  // Debounce: coalesce multiple writes within 1 second
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    ensureDir();
    if (stats) {
      writeFileSync(ECONOMY_FILE, JSON.stringify(stats, null, 2));
    }
  }, 1000);
}

// Flush on exit
process.on("exit", () => {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    ensureDir();
    if (stats) writeFileSync(ECONOMY_FILE, JSON.stringify(stats, null, 2));
  }
});

/** Record token savings from a feature */
export function recordSaving(feature: keyof EconomyStats["savingsByFeature"], tokensSaved: number) {
  const s = loadStats();
  s.totalTokensSaved += tokensSaved;
  s.sessionSaved += tokensSaved;
  s.savingsByFeature[feature] += tokensSaved;
  saveStats();
}

/** Record tokens used (for AI calls) */
export function recordUsage(tokens: number) {
  const s = loadStats();
  s.totalTokensUsed += tokens;
  s.sessionUsed += tokens;
  saveStats();
}

/** Get current economy stats */
export function getEconomyStats(): EconomyStats {
  return { ...loadStats() };
}

/** Format token count for display */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

// ── Weighted economics ──────────────────────────────────────────────────────
// Saved input tokens are repeated across multiple turns before compaction.
// Weighted pricing accounts for the actual billing impact.

/** Provider pricing per million tokens */
const PROVIDER_PRICING: Record<string, { input: number; output: number }> = {
  cerebras:  { input: 0.60, output: 1.20 },
  groq:      { input: 0.15, output: 0.60 },
  xai:       { input: 0.20, output: 1.50 },
  anthropic: { input: 0.80, output: 4.00 }, // Haiku
  "anthropic-sonnet": { input: 3.00, output: 15.00 },
  "anthropic-opus":   { input: 5.00, output: 25.00 },
};

/** Load configurable turns-before-compaction from config.json under the effective data home */
function loadTurnsMultiplier(): number {
  try {
    const configPath = join(DIR, "config.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      return config.economy?.turnsBeforeCompaction ?? 5;
    }
  } catch {}
  return 5; // Default: tokens saved are repeated ~5 turns before agent compacts context
}

/** Estimate USD savings from compressed tokens */
export function estimateSavingsUsd(
  tokensSaved: number,
  consumerModel: string = "anthropic-opus",
  avgTurnsBeforeCompaction?: number,
): { savingsUsd: number; multipliedTokens: number; ratePerMillion: number } {
  if (avgTurnsBeforeCompaction === undefined) {
    avgTurnsBeforeCompaction = loadTurnsMultiplier();
  }
  const pricing = PROVIDER_PRICING[consumerModel] ?? PROVIDER_PRICING["anthropic-opus"];
  const multipliedTokens = tokensSaved * avgTurnsBeforeCompaction;
  const savingsUsd = (multipliedTokens * pricing.input) / 1_000_000;
  return { savingsUsd, multipliedTokens, ratePerMillion: pricing.input };
}

/** Format a full economics summary */
export function formatEconomicsSummary(): string {
  const s = loadStats();
  const opus = estimateSavingsUsd(s.totalTokensSaved, "anthropic-opus");
  const sonnet = estimateSavingsUsd(s.totalTokensSaved, "anthropic-sonnet");
  const haiku = estimateSavingsUsd(s.totalTokensSaved, "anthropic");

  return [
    `Token Economy:`,
    `  Tokens saved:  ${formatTokens(s.totalTokensSaved)}`,
    `  Tokens used:   ${formatTokens(s.totalTokensUsed)}`,
    `  Ratio:         ${s.totalTokensUsed > 0 ? (s.totalTokensSaved / s.totalTokensUsed).toFixed(1) : "∞"}x return`,
    ``,
    `  Estimated USD savings (×5 turns before compaction):`,
    `    Opus ($5/M):   $${opus.savingsUsd.toFixed(2)} (${formatTokens(opus.multipliedTokens)} billable tokens)`,
    `    Sonnet ($3/M): $${sonnet.savingsUsd.toFixed(2)}`,
    `    Haiku ($0.8/M): $${haiku.savingsUsd.toFixed(2)}`,
    ``,
    `  By feature:`,
    `    Compressed: ${formatTokens(s.savingsByFeature.compressed)}`,
    `    Structured: ${formatTokens(s.savingsByFeature.structured)}`,
    `    Diff cache: ${formatTokens(s.savingsByFeature.diff)}`,
    `    NL cache:   ${formatTokens(s.savingsByFeature.cache)}`,
    `    Search:     ${formatTokens(s.savingsByFeature.search)}`,
  ].join("\n");
}
