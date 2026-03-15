// Output intelligence router — auto-detect command type and optimize output

import { parseOutput, estimateTokens } from "./parsers/index.js";
import { compress, stripAnsi } from "./compression.js";
import { recordSaving } from "./economy.js";

export interface RouterResult {
  raw: string;
  structured?: unknown;
  compressed?: string;
  parser?: string;
  tokensSaved: number;
  format: "raw" | "json" | "compressed";
}

/** Route command output through the best optimization path */
export function routeOutput(command: string, output: string, maxTokens?: number): RouterResult {
  const clean = stripAnsi(output);
  const rawTokens = estimateTokens(clean);

  // Try structured parsing first
  const parsed = parseOutput(command, clean);
  if (parsed) {
    const json = JSON.stringify(parsed.data);
    const jsonTokens = estimateTokens(json);
    const saved = rawTokens - jsonTokens;

    if (saved > 0) {
      recordSaving("structured", saved);
      return {
        raw: clean,
        structured: parsed.data,
        parser: parsed.parser,
        tokensSaved: saved,
        format: "json",
      };
    }
  }

  // Try compression if structured didn't save enough
  if (maxTokens || rawTokens > 200) {
    const compressed = compress(command, clean, { maxTokens, format: "text" });
    if (compressed.tokensSaved > 0) {
      recordSaving("compressed", compressed.tokensSaved);
      return {
        raw: clean,
        compressed: compressed.content,
        tokensSaved: compressed.tokensSaved,
        format: "compressed",
      };
    }
  }

  // Return raw if no optimization helps
  return { raw: clean, tokensSaved: 0, format: "raw" };
}
