// Lazy execution — for large result sets, return count + sample + categories
// instead of full output. Agent requests slices on demand.

import { dirname } from "path";

const LAZY_THRESHOLD = 100; // lines before switching to lazy mode

export interface LazyResult {
  lazy: true;
  count: number;
  sample: string[];
  categories?: Record<string, number>;
  hint: string;
}

/** Check if output should use lazy mode */
export function shouldBeLazy(output: string): boolean {
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
    hint: `${lines.length} results. Showing first 20. Use offset/limit to paginate, or narrow your search.`,
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
