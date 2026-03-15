// Token economy tracker — tracks token savings across all interactions

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const DIR = join(homedir(), ".terminal");
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

function saveStats() {
  ensureDir();
  if (stats) {
    writeFileSync(ECONOMY_FILE, JSON.stringify(stats, null, 2));
  }
}

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
