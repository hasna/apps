import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { getDataRoot } from "./paths.js";
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

/**
 * The effective repos data root, resolved through @hasna/paths: an exact-app
 * override (`HASNA_REPOS_HOME`) wins; otherwise the resolver (XDG) data home
 * (`~/.local/share/hasna/repos` on Linux) is used once adopted (`HASNA_DATA_HOME`
 * set, or `repos.db` already migrated there); otherwise the legacy
 * `~/.hasna/repos` default. File-level overrides (`HASNA_REPOS_CONFIG_PATH`,
 * `HASNA_REPOS_HOOK_QUEUE_PATH`, `HASNA_REPOS_DB_PATH`) are layered on top of
 * this root by their own modules.
 */
export function getReposHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return getDataRoot(env);
}

export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return process.env["HASNA_REPOS_CONFIG_PATH"] || resolve(getReposHomeDir(env), "config.json");
}

export function getHookQueuePath(env: NodeJS.ProcessEnv = process.env): string {
  return process.env["HASNA_REPOS_HOOK_QUEUE_PATH"] || resolve(getReposHomeDir(env), "hook-events.tsv");
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
