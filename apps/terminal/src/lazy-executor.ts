// Lazy execution — for large result sets, return count + sample + categories
// instead of full output. Agent requests slices on demand.

import { dirname } from "path";

const LAZY_THRESHOLD = 200; // lines before switching to lazy mode (was 100, too aggressive)

export interface LazyResult {
  lazy: true;
  count: number;
  sample: string[];
  categories?: Record<string, number>;
  hint: string;
}

// Commands where the user explicitly wants full output — never lazify
const PASSTHROUGH_COMMANDS = [
  // File reading — user explicitly wants content
  /\bcat\b/, /\bhead\b/, /\btail\b/, /\bbat\b/, /\bless\b/, /\bmore\b/,
  // Git review commands — truncating diffs/patches loses semantic meaning
  /\bgit\s+diff\b/, /\bgit\s+show\b/, /\bgit\s+log\s+-p\b/, /\bgit\s+log\s+--patch\b/,
  // Summary/report commands — summarizing a summary is pointless
  /\bsummary\b/i, /\bstatus\b/i, /\breport\b/i, /\bstats\b/i,
  /\bweek\b/i, /\btoday\b/i, /\bdashboard\b/i,
];

/** Check if output should use lazy mode */
export function shouldBeLazy(output: string, command?: string): boolean {
  // Never lazify explicit read commands or summary commands
  if (command && PASSTHROUGH_COMMANDS.some(p => p.test(command))) return false;
  return output.split("\n").filter(l => l.trim()).length > LAZY_THRESHOLD;
}

/** Convert large output to lazy format: count + sample + categories */
export function toLazy(output: string, command: string): LazyResult {
  const lines = output.split("\n").filter(l => l.trim());
  const sample = lines.slice(0, 20);

  // Try to categorize by directory (for file-like output)
  const categories: Record<string, number> = {};
  const isFilePaths = lines.filter(l => l.includes("/")).length > lines.length * 0.5;

  if (isFilePaths) {
    for (const line of lines) {
      const dir = dirname(line.trim()) || ".";
      // Group by top-level dir
      const topDir = dir.split("/").slice(0, 2).join("/");
      categories[topDir] = (categories[topDir] ?? 0) + 1;
    }
  }

  return {
    lazy: true,
    count: lines.length,
    sample,
    categories: Object.keys(categories).length > 1 ? categories : undefined,
    hint: `${lines.length} results. Showing first 20. Use terminal exec --offset=20 --limit=20 to paginate.`,
  };
}

/** Get a slice of output */
export function getSlice(output: string, offset: number, limit: number): { lines: string[]; total: number; hasMore: boolean } {
  const allLines = output.split("\n").filter(l => l.trim());
  const slice = allLines.slice(offset, offset + limit);
  return {
    lines: slice,
    total: allLines.length,
    hasMore: offset + limit < allLines.length,
  };
}
