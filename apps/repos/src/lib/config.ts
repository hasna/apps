import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export interface FilterAlias {
  org?: string;
  paths?: string[];
  query?: string;
}

export interface ReposConfig {
  commitLimit?: number;
  incrementalCommitLimit?: number;
  scanDepth?: number;
  excludedPaths?: string[];
  aliases?: Record<string, FilterAlias>;
  workspaceRoots?: string[];
  hookPollIntervalMs?: number;
  watchDebounceMs?: number;
  workspaceRescanIntervalMs?: number;
}

const DEFAULT_CONFIG: ReposConfig = {
  commitLimit: 5000,
  incrementalCommitLimit: 100,
  scanDepth: 5,
  excludedPaths: ["node_modules", "dist", "vendor", ".git"],
  hookPollIntervalMs: 2000,
  watchDebounceMs: 1500,
  workspaceRescanIntervalMs: 30000,
};

let cachedConfig: ReposConfig | null = null;

export function getReposHomeDir(homeDir = homedir()): string {
  return resolve(homeDir, ".hasna", "repos");
}

export function getConfigPath(homeDir = homedir()): string {
  return process.env["HASNA_REPOS_CONFIG_PATH"] || resolve(getReposHomeDir(homeDir), "config.json");
}

export function getHookQueuePath(homeDir = homedir()): string {
  return process.env["HASNA_REPOS_HOOK_QUEUE_PATH"] || resolve(getReposHomeDir(homeDir), "hook-events.tsv");
}

export function getDefaultWorkspaceRoots(
  homeDir = homedir(),
  pathExists: (path: string) => boolean = existsSync,
): string[] {
  const candidates = [resolve(homeDir, "workspace"), resolve(homeDir, "Workspace")];
  const existing = candidates.filter((path, index) => candidates.indexOf(path) === index && pathExists(path));
  return existing.length > 0 ? existing : [candidates[0]!];
}

export function clearConfigCache(): void {
  cachedConfig = null;
}

export function getFilterAlias(name: string): FilterAlias | undefined {
  const cfg = getConfig();
  return cfg.aliases?.[name];
}

export function getWorkspaceRoots(rootDirs?: string[]): string[] {
  if (rootDirs?.length) return rootDirs.map((root) => resolve(root));
  const cfg = getConfig();
  return (cfg.workspaceRoots?.length ? cfg.workspaceRoots : getDefaultWorkspaceRoots()).map((root) => resolve(root));
}

export function getConfig(): ReposConfig {
  if (cachedConfig !== null) return cachedConfig;
  const configPath = getConfigPath();
  const defaults: ReposConfig = {
    ...DEFAULT_CONFIG,
    workspaceRoots: getDefaultWorkspaceRoots(),
  };
  let loaded: ReposConfig = { ...defaults };
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw) as ReposConfig;
      loaded = {
        ...defaults,
        ...parsed,
        workspaceRoots: parsed.workspaceRoots?.length
          ? parsed.workspaceRoots.map((root) => resolve(root))
          : defaults.workspaceRoots,
      };
    } catch { /* use defaults */ }
  }
  cachedConfig = loaded;
  return loaded;
}
