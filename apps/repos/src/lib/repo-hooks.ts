import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getHookQueuePath } from "./config.js";

export const HOOK_MARKER_START = "# >>> hasna repos auto-index >>>";
export const HOOK_MARKER_END = "# <<< hasna repos auto-index <<<";

export interface HookInstallResult {
  repoPath: string;
  hookPath: string | null;
  status: "installed" | "updated" | "unchanged" | "skipped";
  reason?: string;
}

export interface HookInstallSummary {
  installed: number;
  updated: number;
  unchanged: number;
  skipped: number;
  results: HookInstallResult[];
}

export function resolveGitDir(repoPath: string): string | null {
  const dotGitPath = join(repoPath, ".git");
  if (!existsSync(dotGitPath)) return null;

  try {
    const stat = statSync(dotGitPath);
    if (stat.isDirectory()) return dotGitPath;
    const raw = readFileSync(dotGitPath, "utf-8");
    const match = raw.match(/^gitdir:\s*(.+)$/m);
    if (match?.[1]) {
      return resolve(repoPath, match[1].trim());
    }
  } catch {
    return null;
  }

  return null;
}

function buildHookSnippet(queuePath: string): string {
  return `${HOOK_MARKER_START}
HASNA_REPOS_HOOK_QUEUE="${queuePath}"
REPO_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
mkdir -p "$(dirname "$HASNA_REPOS_HOOK_QUEUE")"
printf '%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$REPO_DIR" >> "$HASNA_REPOS_HOOK_QUEUE"
${HOOK_MARKER_END}`;
}

export function installPostCommitHook(repoPath: string, queuePath = getHookQueuePath()): HookInstallResult {
  const gitDir = resolveGitDir(repoPath);
  if (!gitDir) {
    return {
      repoPath,
      hookPath: null,
      status: "skipped",
      reason: "missing_git_dir",
    };
  }

  const hooksDir = join(gitDir, "hooks");
  mkdirSync(hooksDir, { recursive: true });

  const hookPath = join(hooksDir, "post-commit");
  const existed = existsSync(hookPath);
  const existing = existed ? readFileSync(hookPath, "utf-8") : "";

  if (existing.includes(HOOK_MARKER_START)) {
    return { repoPath, hookPath, status: "unchanged" };
  }

  let content = existing.trimEnd();
  if (!content.startsWith("#!")) {
    content = "#!/bin/sh\nset -e\n" + (content ? `\n${content}` : "");
  }
  if (content && !content.endsWith("\n")) content += "\n";
  if (content.trim().length > 0 && !content.endsWith("\n\n")) content += "\n";
  content += `${buildHookSnippet(queuePath)}\n`;

  writeFileSync(hookPath, content);
  chmodSync(hookPath, 0o755);

  return {
    repoPath,
    hookPath,
    status: existed ? "updated" : "installed",
  };
}

export function installPostCommitHooks(repoPaths: string[], queuePath = getHookQueuePath()): HookInstallSummary {
  const results = repoPaths.map((repoPath) => installPostCommitHook(repoPath, queuePath));
  return {
    installed: results.filter((result) => result.status === "installed").length,
    updated: results.filter((result) => result.status === "updated").length,
    unchanged: results.filter((result) => result.status === "unchanged").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    results,
  };
}

export function drainHookQueue(queuePath = getHookQueuePath()): string[] {
  if (!existsSync(queuePath)) return [];

  const raw = readFileSync(queuePath, "utf-8");
  writeFileSync(queuePath, "");

  const queue = raw.trim();
  if (!queue) return [];

  const repos = new Set<string>();
  for (const line of queue.split("\n")) {
    const parts = line.split("\t");
    const repoPath = parts[parts.length - 1]?.trim();
    if (!repoPath) continue;
    repos.add(resolve(repoPath));
  }

  return Array.from(repos);
}
