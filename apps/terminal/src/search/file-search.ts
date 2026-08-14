// Smart file search — structured, filtered, token-efficient results

import { spawn } from "child_process";
import { DEFAULT_EXCLUDE_DIRS, isSourceFile, isExcludedDir, relevanceScore } from "./filters.js";
import { getShell } from "../shell.js";

export interface FileSearchResult {
  query: string;
  total: number;
  source: string[];
  config: string[];
  other: string[];
  filtered: { count: number; reason: string }[];
  tokensSaved?: number;
}

function exec(command: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn(getShell(), ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("close", () => resolve(out));
  });
}

export async function searchFiles(
  pattern: string,
  cwd: string,
  options: { includeNodeModules?: boolean; maxResults?: number } = {}
): Promise<FileSearchResult> {
  const { includeNodeModules = false, maxResults = 50 } = options;

  // Build find command
  const excludes = includeNodeModules
    ? DEFAULT_EXCLUDE_DIRS.filter(d => d !== "node_modules")
    : DEFAULT_EXCLUDE_DIRS;

  const excludeArgs = excludes.map(d => `-not -path '*/${d}/*'`).join(" ");
  const command = `find . -name '${pattern}' -type f ${excludeArgs} 2>/dev/null | head -${maxResults * 3}`;

  const raw = await exec(command, cwd);
  const allPaths = raw.split("\n").filter(l => l.trim());

  // Categorize
  const source: string[] = [];
  const config: string[] = [];
  const other: string[] = [];
  const filteredCounts: Record<string, number> = {};

  for (const path of allPaths) {
    if (isExcludedDir(path)) {
      const dir = DEFAULT_EXCLUDE_DIRS.find(d => path.includes(`/${d}/`)) ?? "other";
      filteredCounts[dir] = (filteredCounts[dir] ?? 0) + 1;
      continue;
    }

    if (isSourceFile(path)) {
      source.push(path);
    } else if (path.match(/\.(json|yaml|yml|toml|ini|env)/)) {
      config.push(path);
    } else {
      other.push(path);
    }
  }

  // Sort by relevance
  source.sort((a, b) => relevanceScore(b) - relevanceScore(a));

  // Limit results
  const filtered = Object.entries(filteredCounts).map(([reason, count]) => ({ reason, count }));

  // Estimate token savings
  const rawTokens = Math.ceil(raw.length / 4);
  const result: FileSearchResult = {
    query: pattern,
    total: allPaths.length,
    source: source.slice(0, maxResults),
    config: config.slice(0, 10),
    other: other.slice(0, 10),
    filtered,
  };
  const resultTokens = Math.ceil(JSON.stringify(result).length / 4);
  result.tokensSaved = Math.max(0, rawTokens - resultTokens);

  return result;
}
