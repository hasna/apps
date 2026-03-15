// Output parser registry — auto-detect command output type and parse to structured JSON

import type { Parser } from "./base.js";
import { lsParser, findParser } from "./files.js";
import { testParser } from "./tests.js";
import { gitLogParser, gitStatusParser } from "./git.js";
import { buildParser, npmInstallParser } from "./build.js";
import { errorParser } from "./errors.js";

export type { Parser } from "./base.js";
export type {
  FileEntry, TestResult, GitLogEntry, GitStatus,
  BuildResult, NpmInstallResult, ErrorInfo, SearchResult,
} from "./base.js";

// Ordered by specificity — more specific parsers first
const parsers: Parser[] = [
  npmInstallParser,
  testParser,
  gitLogParser,
  gitStatusParser,
  buildParser,
  findParser,
  lsParser,
  errorParser, // fallback for error detection
];

export interface ParseResult {
  parser: string;
  data: unknown;
  raw: string;
}

/** Try to parse command output with the best matching parser */
export function parseOutput(command: string, output: string): ParseResult | null {
  for (const parser of parsers) {
    if (parser.detect(command, output)) {
      try {
        const data = parser.parse(command, output);
        return { parser: parser.name, data, raw: output };
      } catch {
        continue;
      }
    }
  }
  return null;
}

/** Get all parsers that match (for debugging/info) */
export function detectParsers(command: string, output: string): string[] {
  return parsers.filter(p => p.detect(command, output)).map(p => p.name);
}

/** Estimate token count for a string (rough: ~4 chars per token) */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Calculate token savings between raw output and parsed JSON */
export function tokenSavings(raw: string, parsed: unknown): { rawTokens: number; parsedTokens: number; saved: number; percent: number } {
  const rawTokens = estimateTokens(raw);
  const parsedTokens = estimateTokens(JSON.stringify(parsed));
  const saved = Math.max(0, rawTokens - parsedTokens);
  const percent = rawTokens > 0 ? Math.round((saved / rawTokens) * 100) : 0;
  return { rawTokens, parsedTokens, saved, percent };
}
