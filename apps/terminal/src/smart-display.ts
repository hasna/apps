// Smart output display — compress repetitive output into grouped patterns

import { dirname, basename } from "path";

interface GroupedEntry {
  type: "single" | "pattern" | "duplicate" | "collapsed";
  display: string;
}

/** Detect if lines look like file paths */
function looksLikePaths(lines: string[]): boolean {
  if (lines.length < 3) return false;
  const pathLike = lines.filter(l => l.trim().match(/^\.?\//) || l.trim().includes("/"));
  return pathLike.length > lines.length * 0.6;
}

/** Find the varying part between similar strings and create a glob pattern */
function findPattern(items: string[]): string | null {
  if (items.length < 2) return null;
  const first = items[0];
  const last = items[items.length - 1];

  // Find common prefix
  let prefixLen = 0;
  while (prefixLen < first.length && prefixLen < last.length && first[prefixLen] === last[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix
  let suffixLen = 0;
  while (
    suffixLen < first.length - prefixLen &&
    suffixLen < last.length - prefixLen &&
    first[first.length - 1 - suffixLen] === last[last.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const prefix = first.slice(0, prefixLen);
  const suffix = suffixLen > 0 ? first.slice(-suffixLen) : "";

  if (prefix.length + suffix.length < first.length * 0.3) return null; // too different

  return `${prefix}*${suffix}`;
}

/** Group file paths by directory */
function groupByDir(paths: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const p of paths) {
    const dir = dirname(p.trim());
    const file = basename(p.trim());
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(file);
  }
  return groups;
}

/** Detect duplicate filenames across directories */
function findDuplicates(paths: string[]): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const p of paths) {
    const file = basename(p.trim());
    if (!byName.has(file)) byName.set(file, []);
    byName.get(file)!.push(dirname(p.trim()));
  }
  // Only return files that appear in 2+ dirs
  const dupes = new Map<string, string[]>();
  for (const [file, dirs] of byName) {
    if (dirs.length >= 2) dupes.set(file, dirs);
  }
  return dupes;
}

/** Collapse node_modules paths */
function collapseNodeModules(paths: string[]): { nodeModulesPaths: string[]; otherPaths: string[] } {
  const nodeModulesPaths: string[] = [];
  const otherPaths: string[] = [];
  for (const p of paths) {
    if (p.includes("node_modules")) {
      nodeModulesPaths.push(p);
    } else {
      otherPaths.push(p);
    }
  }
  return { nodeModulesPaths, otherPaths };
}

/** Smart display: compress file path output into grouped patterns */
export function smartDisplay(lines: string[]): string[] {
  if (lines.length <= 5) return lines;

  // Try ls -la table compression first
  const lsCompressed = compressLsTable(lines);
  if (lsCompressed) return lsCompressed;

  if (!looksLikePaths(lines)) return compressGeneric(lines);

  const paths = lines.map(l => l.trim()).filter(l => l);
  const result: string[] = [];

  // Step 1: Separate node_modules
  const { nodeModulesPaths, otherPaths } = collapseNodeModules(paths);

  // Step 2: Find duplicates in non-node_modules paths
  const dupes = findDuplicates(otherPaths);
  const handledPaths = new Set<string>();

  // Show duplicates first
  for (const [file, dirs] of dupes) {
    if (dirs.length >= 3) {
      result.push(`  **/${file}  ×${dirs.length}`);
      result.push(`    ${dirs.slice(0, 5).join(", ")}${dirs.length > 5 ? ` +${dirs.length - 5} more` : ""}`);
      for (const d of dirs) {
        handledPaths.add(`${d}/${file}`);
      }
    }
  }

  // Step 3: Group remaining by directory
  const remaining = otherPaths.filter(p => !handledPaths.has(p.trim()));
  const dirGroups = groupByDir(remaining);

  for (const [dir, files] of dirGroups) {
    if (files.length === 1) {
      result.push(`  ${dir}/${files[0]}`);
    } else if (files.length <= 3) {
      result.push(`  ${dir}/`);
      for (const f of files) result.push(`    ${f}`);
    } else {
      // Try to find a pattern
      const sorted = files.sort();
      const pattern = findPattern(sorted);
      if (pattern) {
        const dateRange = collapseDateRange(sorted);
        const rangeStr = dateRange ? ` (${dateRange})` : "";
        result.push(`  ${dir}/${pattern}  ×${files.length}${rangeStr}`);
      } else {
        result.push(`  ${dir}/ (${files.length} files)`);
        // Show first 2 + count
        result.push(`    ${sorted[0]}, ${sorted[1]}${files.length > 2 ? `, +${files.length - 2} more` : ""}`);
      }
    }
  }

  // Step 4: Collapsed node_modules summary
  if (nodeModulesPaths.length > 0) {
    if (nodeModulesPaths.length <= 2) {
      for (const p of nodeModulesPaths) result.push(`  ${p}`);
    } else {
      // Group node_modules by package name
      const nmGroups = new Map<string, number>();
      for (const p of nodeModulesPaths) {
        // Extract package name from path: ./X/node_modules/PKG/...
        const match = p.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
        const pkg = match ? match[1] : "other";
        nmGroups.set(pkg, (nmGroups.get(pkg) ?? 0) + 1);
      }
      result.push(`  node_modules/ (${nodeModulesPaths.length} matches)`);
      const topPkgs = [...nmGroups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      for (const [pkg, count] of topPkgs) {
        result.push(`    ${pkg}  ×${count}`);
      }
      if (nmGroups.size > 3) {
        result.push(`    +${nmGroups.size - 3} more packages`);
      }
    }
  }

  return result;
}

/** Detect date range in timestamps and collapse */
function collapseDateRange(files: string[]): string | null {
  const timestamps: Date[] = [];
  for (const f of files) {
    const match = f.match(/(\d{4})-(\d{2})-(\d{2})T?(\d{2})?/);
    if (match) {
      const [, y, m, d, h] = match;
      timestamps.push(new Date(`${y}-${m}-${d}T${h ?? "00"}:00:00`));
    }
  }
  if (timestamps.length < 2) return null;
  timestamps.sort((a, b) => a.getTime() - b.getTime());
  const first = timestamps[0];
  const last = timestamps[timestamps.length - 1];
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  if (first.toDateString() === last.toDateString()) {
    return `${fmt(first)}`;
  }
  return `${fmt(first)}–${fmt(last)}`;
}

/** Detect and compress ls -la style table output */
function compressLsTable(lines: string[]): string[] | null {
  // Detect ls -la format: permissions size date name
  const lsPattern = /^[dlcbps-][rwxsStT-]{9}\s+\d+\s+\S+\s+\S+\s+\S+\s+\w+\s+\d+\s+[\d:]+\s+.+$/;
  const isLsOutput = lines.filter(l => lsPattern.test(l.trim())).length > lines.length * 0.5;
  if (!isLsOutput) return null;

  const result: string[] = [];
  const dirs: string[] = [];
  const files: { name: string; size: string }[] = [];
  let totalSize = 0;

  for (const line of lines) {
    const match = line.trim().match(/^([dlcbps-])[rwxsStT-]{9}\s+\d+\s+\S+\s+\S+\s+(\S+)\s+\w+\s+\d+\s+[\d:]+\s+(.+)$/);
    if (!match) {
      if (line.trim().startsWith("total ")) continue;
      result.push(line);
      continue;
    }

    const [, type, sizeStr, name] = match;
    const size = parseInt(sizeStr) || 0;
    totalSize += size;

    if (type === "d") {
      dirs.push(name);
    } else {
      files.push({ name, size: formatSize(size) });
    }
  }

  // Compact display
  if (dirs.length > 0) {
    result.push(`  📁 ${dirs.join("  ")}${dirs.length > 5 ? ` (+${dirs.length - 5} more)` : ""}`);
  }
  if (files.length <= 8) {
    for (const f of files) {
      result.push(`  ${f.size.padStart(6)}  ${f.name}`);
    }
  } else {
    // Show top 5 by size + count
    const sorted = files.sort((a, b) => parseSize(b.size) - parseSize(a.size));
    for (const f of sorted.slice(0, 5)) {
      result.push(`  ${f.size.padStart(6)}  ${f.name}`);
    }
    result.push(`  ... +${files.length - 5} more files (${formatSize(totalSize)} total)`);
  }

  return result;
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}M`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)}K`;
  return `${bytes}B`;
}

function parseSize(s: string): number {
  const match = s.match(/([\d.]+)([BKMG])?/);
  if (!match) return 0;
  const n = parseFloat(match[1]);
  const unit = match[2];
  if (unit === "K") return n * 1000;
  if (unit === "M") return n * 1000000;
  if (unit === "G") return n * 1000000000;
  return n;
}

/** Compress non-path generic output by deduplicating similar lines */
function compressGeneric(lines: string[]): string[] {
  if (lines.length <= 10) return lines;

  const result: string[] = [];
  let repeatCount = 0;
  let lastPattern = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Normalize: remove numbers, timestamps, hashes for pattern matching
    const pattern = line
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.-]+Z?/g, "TIMESTAMP")
      .replace(/\b[0-9a-f]{7,40}\b/g, "HASH")
      .replace(/\b\d+\b/g, "N")
      .trim();

    if (pattern === lastPattern && i > 0) {
      repeatCount++;
    } else {
      if (repeatCount > 1) {
        result.push(`  ... ×${repeatCount} similar`);
      } else if (repeatCount === 1) {
        result.push(lines[i - 1]);
      }
      result.push(line);
      lastPattern = pattern;
      repeatCount = 0;
    }
  }

  if (repeatCount > 1) {
    result.push(`  ... ×${repeatCount} similar`);
  } else if (repeatCount === 1) {
    result.push(lines[lines.length - 1]);
  }

  return result;
}
