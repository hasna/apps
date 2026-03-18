// Smart content search — structured grep/ripgrep with grouping and dedup

import { spawn } from "child_process";
import { DEFAULT_EXCLUDE_DIRS, relevanceScore } from "./filters.js";

export interface ContentMatch {
  line: number;
  content: string;
  context?: string[];
}

export interface ContentFileMatch {
  path: string;
  matches: ContentMatch[];
  relevance: number;
}

export interface ContentSearchResult {
  query: string;
  totalMatches: number;
  files: ContentFileMatch[];
  filtered: { count: number; reason: string }[];
  tokensSaved?: number;
}

function exec(command: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn("/bin/zsh", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("close", () => resolve(out));
  });
}

export async function searchContent(
  pattern: string,
  cwd: string,
  options: { fileType?: string; maxResults?: number; contextLines?: number } = {}
): Promise<ContentSearchResult> {
  const { fileType, maxResults = 30, contextLines = 0 } = options;

  // Prefer ripgrep, fall back to grep
  const excludeArgs = DEFAULT_EXCLUDE_DIRS.map(d => `--glob '!${d}'`).join(" ");
  const typeArg = fileType ? `--type ${fileType}` : "";
  const contextArg = contextLines > 0 ? `-C ${contextLines}` : "";

  // Try rg first, fall back to grep
  const rgCmd = `rg --line-number --no-heading ${contextArg} ${typeArg} ${excludeArgs} '${pattern.replace(/'/g, "'\\''")}' 2>/dev/null | head -500`;
  const grepCmd = `grep -rn ${contextArg} '${pattern.replace(/'/g, "'\\''")}' . --include='*.ts' --include='*.js' --include='*.py' --include='*.go' --include='*.rs' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist 2>/dev/null | head -500`;

  let raw = await exec(rgCmd, cwd);
  if (!raw.trim()) {
    raw = await exec(grepCmd, cwd);
  }

  const lines = raw.split("\n").filter(l => l.trim());
  const fileMap = new Map<string, ContentMatch[]>();
  let filteredCount = 0;

  for (const line of lines) {
    // Format: path:line:content
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!match) continue;

    const [, path, lineNum, content] = match;
    if (DEFAULT_EXCLUDE_DIRS.some(d => path.includes(`/${d}/`))) {
      filteredCount++;
      continue;
    }

    if (!fileMap.has(path)) fileMap.set(path, []);
    fileMap.get(path)!.push({
      line: parseInt(lineNum),
      content: content.trim(),
    });
  }

  // Sort files by relevance
  const files: ContentFileMatch[] = [...fileMap.entries()]
    .map(([path, matches]) => ({
      path,
      matches: matches.slice(0, 5), // max 5 matches per file
      relevance: relevanceScore(path),
    }))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, maxResults);

  const totalMatches = [...fileMap.values()].reduce((sum, m) => sum + m.length, 0);
  const filtered = filteredCount > 0 ? [{ count: filteredCount, reason: "excluded directories" }] : [];

  const rawTokens = Math.ceil(raw.length / 4);
  const truncated = totalMatches > files.reduce((s, f) => s + f.matches.length, 0);
  const result: ContentSearchResult = { query: pattern, totalMatches, files, filtered };
  const resultTokens = Math.ceil(JSON.stringify(result).length / 4);
  result.tokensSaved = Math.max(0, rawTokens - resultTokens);
  (result as any).truncated = truncated;

  // Overflow guard — warn when results are truncated
  if (totalMatches > maxResults * 3) {
    (result as any).overflow = {
      warning: `${totalMatches} total matches across ${fileMap.size} files — showing top ${files.length}`,
      suggestion: "Try a more specific pattern, add fileType filter, or use -l to list files only",
    };
  }

  return result;
}
