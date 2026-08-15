import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { canonicalPath } from "./path-identity.js";

export interface FilterAlias {
  org?: string;
  paths?: string[];
  query?: string;
}

/**
 * How the repository-plane verbs obtain their GitHub credential. This is
 * station configuration, deliberately: the *calling agent* has no say in it —
 * caller token variables are scrubbed before any `gh` child is spawned — and
 * the station operator picks the source once, here, rather than per call.
 *
 * `credentialCommand` is an argv whose stdout is the token (for example a
 * vault read). No command configured means the station's own `gh` credential
 * store answers. Neither branch ever falls back to the other: a configured
 * command that fails is a hard, typed error, not a silent downgrade.
 */
export interface GithubCredentialConfig {
  credentialCommand?: string[];
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
  github?: GithubCredentialConfig;
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

/**
 * Dedupe a list of roots by canonical filesystem identity, keeping the FIRST
 * spelling of a directory that resolves to the same real path. On a
 * case-insensitive filesystem (macOS APFS) `~/workspace` and `~/Workspace`
 * are one directory, and returning both made the scanner walk every checkout
 * twice and index it twice. On a case-sensitive filesystem distinct
 * directories stay distinct, and a case-variant that does not exist resolves
 * to itself and is kept (callers that need existence filter first).
 */
export function dedupeRootsByCanonicalPath(roots: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const root of roots) {
    const key = canonicalPath(root);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(root);
  }
  return deduped;
}

export function getDefaultWorkspaceRoots(
  homeDir = homedir(),
  pathExists: (path: string) => boolean = existsSync,
): string[] {
  const candidates = [resolve(homeDir, "workspace"), resolve(homeDir, "Workspace")];
  const existing = candidates.filter(pathExists);
  const deduped = dedupeRootsByCanonicalPath(existing);
  return deduped.length > 0 ? deduped : [candidates[0]!];
}

export function clearConfigCache(): void {
  cachedConfig = null;
}

export function getFilterAlias(name: string): FilterAlias | undefined {
  const cfg = getConfig();
  return cfg.aliases?.[name];
}

export function getWorkspaceRoots(rootDirs?: string[]): string[] {
  if (rootDirs?.length) return dedupeRootsByCanonicalPath(rootDirs.map((root) => resolve(root)));
  const cfg = getConfig();
  return dedupeRootsByCanonicalPath(
    (cfg.workspaceRoots?.length ? cfg.workspaceRoots : getDefaultWorkspaceRoots()).map((root) => resolve(root)),
  );
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
