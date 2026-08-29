// AI-powered output processor — uses cheap AI to intelligently summarize any output
// NOTHING is hardcoded. The AI decides what's important, what's noise, what to keep.

import { getProvider, getOutputProvider } from "./providers/index.js";
import { estimateTokens } from "./tokens.js";
import { recordSaving } from "./economy.js";
import { discoverOutputHints } from "./context-hints.js";
import { formatProfileHints } from "./tool-profiles.js";
import { stripAnsi } from "./compression.js";
import { stripNoise } from "./noise-filter.js";
import {
  summarizeDiffStat,
  summarizeFileListing,
  summarizeGitShortStatus,
  summarizeSearchOutput,
} from "./terminal-summaries.js";

export interface ProcessedOutput {
  /** AI-generated summary (concise, structured) */
  summary: string;
  /** Full original output (always available) */
  full: string;
  /** Structured JSON if the AI could extract it */
  structured?: Record<string, unknown>;
  /** How many tokens were saved (net, after subtracting AI cost) */
  tokensSaved: number;
  /** Tokens used by the AI summarization call */
  aiTokensUsed: number;
  /** Whether AI processing was used (vs passthrough) */
  aiProcessed: boolean;
  /** Cost of the AI call in USD (Cerebras pricing) */
  aiCostUsd: number;
  /** Value of tokens saved in USD (at Claude Sonnet rates) */
  savingsValueUsd: number;
  /** Net ROI: savings minus AI cost */
  netSavingsUsd: number;
}

const MIN_LINES_TO_PROCESS = 15;
const MAX_OUTPUT_FOR_AI = 6000;

// ── Output fingerprinting — skip AI for outputs we can summarize instantly ──
// These patterns match common terminal outputs that don't need AI interpretation.
// Returns a short summary string, or null if AI should handle it.

function fingerprint(command: string, output: string, exitCode?: number): string | null {
  const trimmed = output.trim();
  const lines = trimmed.split("\n").filter(l => l.trim());

  // Empty output with success — provide context-aware confirmation
  if (lines.length === 0 && (exitCode === 0 || exitCode === undefined)) {
    // Write commands get a specific confirmation
    if (/\btee\b|>\s*\S|>>|cat\s*<<|echo\s.*>|sed\s+-i|cp\b|mv\b|mkdir\b|touch\b/.test(command)) {
      return "✓ Write succeeded (no output)";
    }
    return "✓ Success (no output)";
  }

  // Git: common known patterns
  if (/^Already up to date\.?$/i.test(trimmed)) return "✓ Already up to date";
  if (/^nothing to commit, working tree clean$/i.test(trimmed)) return "✓ Clean working tree, nothing to commit";
  if (/^On branch \S+\nnothing to commit/m.test(trimmed)) {
    const branch = trimmed.match(/^On branch (\S+)/)?.[1];
    return `✓ On branch ${branch}, clean working tree`;
  }
  if (/^Your branch is up to date/m.test(trimmed) && /nothing to commit/m.test(trimmed)) {
    const branch = trimmed.match(/^On branch (\S+)/m)?.[1] ?? "?";
    return `✓ Branch ${branch} up to date, clean`;
  }
  if (/\bgit\s+status\b/.test(command)) {
    const status = summarizeGitShortStatus(trimmed);
    if (status) return status;
  }
  if (/\bgit\s+diff\b/.test(command) && /--stat\b/.test(command)) {
    const stat = summarizeDiffStat(trimmed);
    if (stat) return stat;
  }
  if (/^(?:rg|grep)\b/.test(command.trim())) {
    const search = summarizeSearchOutput(trimmed);
    if (search) return search;
  }
  if (/^(?:find|fd|rg\s+--files)\b/.test(command.trim())) {
    const listing = summarizeFileListing(trimmed);
    if (listing) return listing;
  }

  // Build/compile success with no errors
  if (/^(tsc|bun|npm|yarn|pnpm)\s/.test(command)) {
    if (lines.length <= 3 && (exitCode === 0 || exitCode === undefined) && !/error|Error|ERROR|fail|FAIL/.test(trimmed)) {
      return "ok";
    }
  }

  // Single-line trivial outputs — pass through without AI
  if (lines.length === 1 && trimmed.length < 80) {
    return trimmed; // Already concise enough
  }

  // npm/bun install success
  if (/\binstall(ed)?\b.*\d+\s+packages?/i.test(trimmed) && !/error|Error|fail/i.test(trimmed)) {
    const pkgMatch = trimmed.match(/(\d+)\s+packages?/);
    return `✓ Installed ${pkgMatch?.[1] ?? "?"} packages`;
  }

  // Permission denied / not found — short errors pass through
  if (lines.length <= 3 && /permission denied|command not found|No such file|ENOENT/i.test(trimmed)) {
    return trimmed; // Already short enough, preserve error verbatim
  }

  // Hash-based dedup: if we've seen this exact output before, return cached summary
  const hash = simpleHash(trimmed);
  const cached = outputCache.get(hash);
  if (cached) return cached;

  return null; // No fingerprint match — AI should handle this
}

// Simple string hash for output dedup
function simpleHash(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return hash;
}

// LRU cache for output summaries (keyed by content hash)
const OUTPUT_CACHE_MAX = 200;
const outputCache = new Map<number, string>();

function cacheOutputSummary(output: string, summary: string): void {
  const hash = simpleHash(output.trim());
  if (outputCache.size >= OUTPUT_CACHE_MAX) {
    const oldest = outputCache.keys().next().value;
    if (oldest !== undefined) outputCache.delete(oldest);
  }
  outputCache.set(hash, summary);
}

const SUMMARIZE_PROMPT = `You are an intelligent terminal assistant. Given a user's original question and the command output, ANSWER THE QUESTION directly.

RULES:
- If the user asked a YES/NO question, start with Yes or No, then explain briefly
- If the user asked "how many", give the number first, then context
- If the user asked "show me X", show only X, not everything
- ANSWER the question using the data — don't just summarize the raw output
- Use symbols: ✓ for success/yes, ✗ for failure/no, ⚠ for warnings
- Maximum 8 lines
- Keep errors/failures verbatim
- Be direct and concise — the user wants an ANSWER, not a data dump
- For TEST OUTPUT: look for "X pass" and "X fail" lines. These are DEFINITIVE. If you see "42 pass, 0 fail" in the output, the answer is "42 tests pass, 0 fail." NEVER say "no tests found" or "incomplete" when pass/fail counts are visible.
- For BUILD OUTPUT: if tsc/build exits 0 with no output, it SUCCEEDED. Empty output = success.
- For GREP/SEARCH OUTPUT (file:line:match format): List ALL matches grouped by file. NEVER summarize into one sentence. Format: "N matches in M files:" then list each match. The agent needs every match, not a prose interpretation.
- For FILE LISTINGS (ls, find): show count + key entries. "23 files: src/ai.ts, src/cli.tsx, ..."
- For GIT LOG/DIFF: preserve commit hashes, file names, and +/- line counts.`;

/**
 * Process command output through AI summarization.
 * Cheap AI call (~100 tokens) saves 1000+ tokens downstream.
 */
export async function processOutput(
  command: string,
  output: string,
  originalPrompt?: string,
  verbosity?: "minimal" | "normal" | "detailed",
): Promise<ProcessedOutput> {
  const lines = output.split("\n");

  // Fingerprint check — skip AI entirely for known patterns (0ms, $0)
  const fp = fingerprint(command, output);
  if (fp) {
    const saved = Math.max(0, estimateTokens(output) - estimateTokens(fp));
    if (saved > 0) recordSaving("compressed", saved);
    return {
      summary: fp,
      full: output,
      tokensSaved: saved,
      aiTokensUsed: 0,
      aiProcessed: false,
      aiCostUsd: 0,
      savingsValueUsd: 0,
      netSavingsUsd: 0,
    };
  }

  // Short output — skip AI UNLESS we have an original prompt (NL mode needs answer framing)
  if (lines.length <= MIN_LINES_TO_PROCESS && !originalPrompt) {
    return {
      summary: output,
      full: output,
      tokensSaved: 0,
      aiTokensUsed: 0,
      aiProcessed: false,
      aiCostUsd: 0,
      savingsValueUsd: 0,
      netSavingsUsd: 0,
    };
  }

  // Clean output before AI processing — strip ANSI codes and noise
  let toSummarize = stripAnsi(output);
  toSummarize = stripNoise(toSummarize).cleaned;

  if (toSummarize.length > MAX_OUTPUT_FOR_AI) {
    const headChars = Math.floor(MAX_OUTPUT_FOR_AI * 0.6);
    const tailChars = Math.floor(MAX_OUTPUT_FOR_AI * 0.3);
    toSummarize = output.slice(0, headChars) +
      `\n\n... (${lines.length} total lines, middle truncated) ...\n\n` +
      output.slice(-tailChars);
  }

  try {
    // Discover output hints — regex discovers patterns, AI decides what matters
    const outputHints = discoverOutputHints(output, command);
    const hintsBlock = outputHints.length > 0
      ? `\n\nOUTPUT OBSERVATIONS:\n${outputHints.join("\n")}`
      : "";

    // Inject tool-specific profile hints
    const profileBlock = formatProfileHints(command);
    const profileHints = profileBlock ? `\n\n${profileBlock}` : "";

    // Use output-optimized provider (Groq: fastest + best compression; model
    // resolved against the key's accessible list — no hardcoded model that can
    // 404, O15-04797). Falls back to main provider if Groq unavailable.
    const provider = getOutputProvider();
    const verbosityHint = verbosity === "minimal" ? "\nBe ULTRA concise — 1-2 lines max. Status + key number only."
      : verbosity === "detailed" ? "\nBe thorough — include all relevant details, up to 15 lines."
      : ""; // normal = default 8 lines from SUMMARIZE_PROMPT
    const maxTok = verbosity === "minimal" ? 100 : verbosity === "detailed" ? 500 : 300;
    const summary = await provider.complete(
      `${originalPrompt ? `User asked: ${originalPrompt}\n` : ""}Command: ${command}\nOutput (${lines.length} lines):\n${toSummarize}${hintsBlock}${profileHints}`,
      {
        system: SUMMARIZE_PROMPT + verbosityHint,
        maxTokens: maxTok,
        temperature: 0.2,
      }
    );

    const originalTokens = estimateTokens(output);
    const summaryTokens = estimateTokens(summary);
    const saved = Math.max(0, originalTokens - summaryTokens);

    // Try to extract structured JSON if the AI returned it
    let structured: Record<string, unknown> | undefined;
    try {
      const jsonMatch = summary.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        structured = JSON.parse(jsonMatch[0]);
      }
    } catch { /* not JSON, that's fine */ }

    // Cost calculation
    // AI input: system prompt (~200 tokens) + command + output sent to AI
    const aiInputTokens = estimateTokens(SUMMARIZE_PROMPT) + estimateTokens(toSummarize) + 20;
    const aiOutputTokens = summaryTokens;
    const aiTokensUsed = aiInputTokens + aiOutputTokens;

    // Cerebras qwen-3-235b pricing: $0.60/M input, $1.20/M output
    const aiCostUsd = (aiInputTokens * 0.60 + aiOutputTokens * 1.20) / 1_000_000;

    // Value of tokens saved (at Claude Sonnet $3/M input — what the agent would pay)
    const savingsValueUsd = (saved * 3.0) / 1_000_000;
    const netSavingsUsd = savingsValueUsd - aiCostUsd;

    // Only record savings if net positive (AI cost < token savings value)
    if (netSavingsUsd > 0 && saved > 0) {
      recordSaving("compressed", saved);
    }

    // Cache the AI summary for future identical outputs
    cacheOutputSummary(output, summary);

    return {
      summary,
      full: output,
      structured,
      tokensSaved: saved,
      aiTokensUsed,
      aiProcessed: true,
      aiCostUsd,
      savingsValueUsd,
      netSavingsUsd,
    };
  } catch {
    // AI unavailable — fall back to simple truncation
    const head = lines.slice(0, 5).join("\n");
    const tail = lines.slice(-5).join("\n");
    const fallback = `${head}\n  ... (${lines.length - 10} lines hidden) ...\n${tail}`;

    return {
      summary: fallback,
      full: output,
      tokensSaved: Math.max(0, estimateTokens(output) - estimateTokens(fallback)),
      aiTokensUsed: 0,
      aiProcessed: false,
      aiCostUsd: 0,
      savingsValueUsd: 0,
      netSavingsUsd: 0,
    };
  }
}

/**
 * Lightweight version — just decides IF output should be processed.
 * Returns true if the output would benefit from AI summarization.
 */
export function shouldProcess(output: string): boolean {
  return output.split("\n").length > MIN_LINES_TO_PROCESS;
}
