// AI-powered output processor — uses cheap AI to intelligently summarize any output
// NOTHING is hardcoded. The AI decides what's important, what's noise, what to keep.

import { getProvider } from "./providers/index.js";
import { estimateTokens } from "./parsers/index.js";
import { recordSaving } from "./economy.js";

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
const MAX_OUTPUT_FOR_AI = 8000; // chars to send to AI (truncate if longer)

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
- For BUILD OUTPUT: if tsc/build exits 0 with no output, it SUCCEEDED. Empty output = success.`;

/**
 * Process command output through AI summarization.
 * Cheap AI call (~100 tokens) saves 1000+ tokens downstream.
 */
export async function processOutput(
  command: string,
  output: string,
  originalPrompt?: string,
): Promise<ProcessedOutput> {
  const lines = output.split("\n");

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

  // Truncate very long output before sending to AI
  let toSummarize = output;
  if (toSummarize.length > MAX_OUTPUT_FOR_AI) {
    const headChars = Math.floor(MAX_OUTPUT_FOR_AI * 0.6);
    const tailChars = Math.floor(MAX_OUTPUT_FOR_AI * 0.3);
    toSummarize = output.slice(0, headChars) +
      `\n\n... (${lines.length} total lines, middle truncated) ...\n\n` +
      output.slice(-tailChars);
  }

  try {
    // Pre-parse: extract test counts so AI can't misread them
    let preParseHint = "";
    const passMatch = output.match(/(\d+)\s+pass/i);
    const failMatch = output.match(/(\d+)\s+fail/i);
    if (passMatch || failMatch) {
      preParseHint = `\nPRE-PARSED TEST RESULTS: ${passMatch?.[1] ?? 0} passed, ${failMatch?.[1] ?? 0} failed. USE THESE NUMBERS.`;
    }

    const provider = getProvider();
    const summary = await provider.complete(
      `${originalPrompt ? `User asked: ${originalPrompt}\n` : ""}Command: ${command}${preParseHint}\nOutput (${lines.length} lines):\n${toSummarize}`,
      {
        system: SUMMARIZE_PROMPT,
        maxTokens: 300,
      }
    );

    const originalTokens = estimateTokens(output);
    const summaryTokens = estimateTokens(summary);
    const saved = Math.max(0, originalTokens - summaryTokens);

    if (saved > 0) {
      recordSaving("compressed", saved);
    }

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
