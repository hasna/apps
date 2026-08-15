// Token compression engine — reduces CLI output to fit within token budgets
// No regex parsing — just ANSI stripping, deduplication, and smart truncation.
// All intelligent output processing goes through AI via processOutput().

import { estimateTokens } from "./tokens.js";

export interface CompressOptions {
  /** Max tokens for the output (default: unlimited) */
  maxTokens?: number;
  /** Strip ANSI escape codes (default: true) */
  stripAnsi?: boolean;
}

export interface CompressedOutput {
  content: string;
  originalTokens: number;
  compressedTokens: number;
  tokensSaved: number;
  savingsPercent: number;
}

/** Strip ANSI escape codes from text */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

/** Deduplicate consecutive similar lines (e.g., "Compiling X... Compiling Y...") */
function deduplicateLines(lines: string[]): string[] {
  if (lines.length <= 3) return lines;

  const result: string[] = [];
  let repeatCount = 0;
  let repeatPattern = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pattern = line.replace(/[0-9]+/g, "N").replace(/\/\S+/g, "/PATH").replace(/\s+/g, " ").trim();

    if (pattern === repeatPattern) {
      repeatCount++;
    } else {
      if (repeatCount > 2) {
        result.push(`  ... (${repeatCount} similar lines)`);
      } else if (repeatCount > 0) {
        for (let j = i - repeatCount; j < i; j++) {
          result.push(lines[j]);
        }
      }
      result.push(line);
      repeatPattern = pattern;
      repeatCount = 0;
    }
  }

  if (repeatCount > 2) {
    result.push(`  ... (${repeatCount} similar lines)`);
  } else {
    for (let j = lines.length - repeatCount; j < lines.length; j++) {
      result.push(lines[j]);
    }
  }

  return result;
}

/** Smart truncation: keep first 60% + last 40% of lines */
function smartTruncate(text: string, maxTokens: number): string {
  const lines = text.split("\n");
  const currentTokens = estimateTokens(text);

  if (currentTokens <= maxTokens) return text;

  const targetLines = Math.floor((maxTokens * lines.length) / currentTokens);
  const firstCount = Math.ceil(targetLines * 0.6);
  const lastCount = Math.floor(targetLines * 0.4);

  if (firstCount + lastCount >= lines.length) return text;

  const first = lines.slice(0, firstCount);
  const last = lines.slice(-lastCount);
  const hiddenCount = lines.length - firstCount - lastCount;

  return [...first, `\n--- ${hiddenCount} lines hidden ---\n`, ...last].join("\n");
}

/** Compress command output — ANSI strip, dedup, truncate. No parsing. */
export function compress(command: string, output: string, options: CompressOptions = {}): CompressedOutput {
  const { maxTokens, stripAnsi: doStrip = true } = options;
  const originalTokens = estimateTokens(output);

  // Short output — no-op, skip all processing
  if (output.split("\n").length <= 20 && !maxTokens) {
    const clean = doStrip ? stripAnsi(output) : output;
    const cleanTokens = estimateTokens(clean);
    return { content: clean, originalTokens, compressedTokens: cleanTokens, tokensSaved: Math.max(0, originalTokens - cleanTokens), savingsPercent: 0 };
  }

  // Step 1: Strip ANSI codes
  let text = doStrip ? stripAnsi(output) : output;

  // Step 2: Deduplicate similar lines
  const lines = text.split("\n");
  const deduped = deduplicateLines(lines);
  text = deduped.join("\n");

  // Step 3: Smart truncation if over budget
  if (maxTokens) {
    text = smartTruncate(text, maxTokens);
  }

  const compressedTokens = estimateTokens(text);
  return {
    content: text,
    originalTokens,
    compressedTokens,
    tokensSaved: Math.max(0, originalTokens - compressedTokens),
    savingsPercent: originalTokens > 0 ? Math.round(((originalTokens - compressedTokens) / originalTokens) * 100) : 0,
  };
}
