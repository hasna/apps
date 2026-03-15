// Parser for file listing output (ls -la, find, etc.)

import type { Parser, FileEntry, SearchResult } from "./base.js";

const NODE_MODULES_RE = /node_modules/;
const DIST_RE = /\b(dist|build|\.next|__pycache__|coverage|\.git)\b/;
const SOURCE_EXTS = /\.(ts|tsx|js|jsx|py|go|rs|java|rb|sh|c|cpp|h|css|scss|html|vue|svelte|md|json|yaml|yml|toml)$/;

export const lsParser: Parser<FileEntry[]> = {
  name: "ls",

  detect(command: string, output: string): boolean {
    return /^\s*(ls|ll|la)\b/.test(command) && output.includes(" ");
  },

  parse(_command: string, output: string): FileEntry[] {
    const lines = output.split("\n").filter(l => l.trim());
    const entries: FileEntry[] = [];

    for (const line of lines) {
      // ls -la format: drwxr-xr-x  5 user group 160 Mar 10 09:00 dirname
      const match = line.match(/^([dlcbps-])([rwxsStT-]{9})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w+\s+\d+\s+[\d:]+)\s+(.+)$/);
      if (match) {
        const typeChar = match[1];
        entries.push({
          name: match[5],
          type: typeChar === "d" ? "dir" : typeChar === "l" ? "symlink" : "file",
          size: parseInt(match[3]),
          modified: match[4],
          permissions: match[1] + match[2],
        });
      } else if (line.trim() && !line.startsWith("total ")) {
        // Simple ls output — just filenames
        entries.push({ name: line.trim(), type: "file" });
      }
    }

    return entries;
  },
};

export const findParser: Parser<SearchResult> = {
  name: "find",

  detect(command: string, _output: string): boolean {
    return /^\s*(find|fd)\b/.test(command);
  },

  parse(_command: string, output: string): SearchResult {
    const lines = output.split("\n").filter(l => l.trim());
    const source: FileEntry[] = [];
    const other: FileEntry[] = [];
    let nodeModulesCount = 0;
    let distCount = 0;

    for (const line of lines) {
      const path = line.trim();
      if (!path) continue;

      if (NODE_MODULES_RE.test(path)) {
        nodeModulesCount++;
        continue;
      }

      if (DIST_RE.test(path)) {
        distCount++;
        continue;
      }

      const name = path.split("/").pop() ?? path;
      const entry: FileEntry = { name: path, type: SOURCE_EXTS.test(name) ? "file" : "other" };

      if (SOURCE_EXTS.test(name)) {
        source.push(entry);
      } else {
        other.push(entry);
      }
    }

    const filtered: { count: number; reason: string }[] = [];
    if (nodeModulesCount > 0) filtered.push({ count: nodeModulesCount, reason: "node_modules" });
    if (distCount > 0) filtered.push({ count: distCount, reason: "dist/build" });

    return {
      total: lines.length,
      source,
      other,
      filtered,
    };
  },
};
