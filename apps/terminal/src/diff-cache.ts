// Diff-aware output caching — when same command runs again, return only what changed

import { estimateTokens } from "./parsers/index.js";

interface CachedOutput {
  command: string;
  cwd: string;
  output: string;
  timestamp: number;
}

const cache = new Map<string, CachedOutput>();

function cacheKey(command: string, cwd: string): string {
  return `${cwd}:${command}`;
}

/** Compute a simple line diff between two outputs */
function lineDiff(prev: string, curr: string): { added: string[]; removed: string[]; unchanged: number } {
  const prevLines = new Set(prev.split("\n"));
  const currLines = curr.split("\n");

  const added: string[] = [];
  const removed: string[] = [];
  let unchanged = 0;

  for (const line of currLines) {
    if (prevLines.has(line)) {
      unchanged++;
      prevLines.delete(line);
    } else {
      added.push(line);
    }
  }

  for (const line of prevLines) {
    removed.push(line);
  }

  return { added, removed, unchanged };
}

/** Generate a human-readable diff summary */
function summarizeDiff(diff: { added: string[]; removed: string[]; unchanged: number }): string {
  const parts: string[] = [];
  if (diff.added.length > 0) parts.push(`+${diff.added.length} new lines`);
  if (diff.removed.length > 0) parts.push(`-${diff.removed.length} removed lines`);
  parts.push(`${diff.unchanged} unchanged`);
  return parts.join(", ");
}

export interface DiffResult {
  /** Full current output */
  full: string;
  /** Was there a previous run to diff against? */
  hasPrevious: boolean;
  /** Lines added since last run */
  added: string[];
  /** Lines removed since last run */
  removed: string[];
  /** Summary of changes */
  diffSummary: string;
  /** Whether output is identical to last run */
  unchanged: boolean;
  /** Tokens saved by returning diff instead of full output */
  tokensSaved: number;
}

/** Run diffing on command output. Caches the output for next comparison. */
export function diffOutput(command: string, cwd: string, output: string): DiffResult {
  const key = cacheKey(command, cwd);
  const prev = cache.get(key);

  // Store current for next time
  cache.set(key, { command, cwd, output, timestamp: Date.now() });

  if (!prev) {
    return {
      full: output,
      hasPrevious: false,
      added: [],
      removed: [],
      diffSummary: "first run",
      unchanged: false,
      tokensSaved: 0,
    };
  }

  if (prev.output === output) {
    const fullTokens = estimateTokens(output);
    return {
      full: output,
      hasPrevious: true,
      added: [],
      removed: [],
      diffSummary: "identical to previous run",
      unchanged: true,
      tokensSaved: fullTokens - 10, // ~10 tokens for the "unchanged" message
    };
  }

  const diff = lineDiff(prev.output, output);
  const diffContent = [
    ...diff.added.map(l => `+ ${l}`),
    ...diff.removed.map(l => `- ${l}`),
  ].join("\n");

  const fullTokens = estimateTokens(output);
  const diffTokens = estimateTokens(diffContent);

  return {
    full: output,
    hasPrevious: true,
    added: diff.added,
    removed: diff.removed,
    diffSummary: summarizeDiff(diff),
    unchanged: false,
    tokensSaved: Math.max(0, fullTokens - diffTokens),
  };
}

/** Clear the diff cache */
export function clearDiffCache(): void {
  cache.clear();
}
