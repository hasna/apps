import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/**
 * Resolve the user's home directory: $HOME, then $USERPROFILE (Windows), then
 * the OS user database. A home that cannot be resolved is a hard error — never
 * a literal "~" path (relative to cwd) and never an "undefined"-prefixed path.
 */
export function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (!home) {
    throw new Error("Unable to resolve the user's home directory");
  }
  return home;
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for repos.
 * This is the forward-looking home the XDG migration (hotfixes plan
 * 0f49f56a, task P3.3) moves the repos store toward: `~/.local/share/hasna/repos`
 * on Linux, `~/Library/Application Support/Hasna/repos` on macOS. The home
 * override mirrors the pre-existing $HOME-first resolution so the resolver
 * follows the same home the legacy path does.
 */
export function getResolverDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return dataDir({ app: "repos", home: getHomeDir(env), env });
}

/** The legacy (pre-XDG) data root: ~/.hasna/repos */
export function getLegacyDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", "repos");
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective
 * data root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`repos.db` exists). A machine that only redirects another kind (e.g.
 * cache to tmpfs) must NOT have its data home moved, and a live store at the
 * legacy home must never become invisible on upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "repos.db"));
}

/** The exact-app override root, when set: `HASNA_REPOS_HOME`. */
export function getExactDataRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env["HASNA_REPOS_HOME"];
  if (dir && dir.trim()) return resolve(dir.trim());
  return undefined;
}

/**
 * The effective data root: an exact-app override (`HASNA_REPOS_HOME`) wins
 * unconditionally; otherwise the resolver (XDG) data root once adopted;
 * otherwise the legacy `~/.hasna/repos` default. File-level overrides
 * (`HASNA_REPOS_CONFIG_PATH`, `HASNA_REPOS_DB_PATH`, `REPOS_DB_PATH`,
 * `HASNA_REPOS_HOOK_QUEUE_PATH`, `HASNA_REPOS_GITHUB_CACHE_PATH`) are layered
 * on top of this root by their own modules, so an explicit path always wins
 * regardless.
 */
export function getDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return getDataRootForHome(getHomeDir(env), env);
}

/**
 * The effective data root for an explicitly supplied home directory, used by
 * callers that keep a `homeDir` parameter for backward compatibility. Applies
 * the same gating as `getDataRoot`: `HASNA_REPOS_HOME` wins unconditionally,
 * then the resolver (XDG) data root once adopted, then the legacy
 * `~/.hasna/repos` default under the given home.
 */
export function getDataRootForHome(
  homeDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const exact = getExactDataRoot(env);
  if (exact) return exact;
  const resolved = dataDir({ app: "repos", home: homeDir, env });
  return adoptResolverDataRoot(resolved, env) ? resolve(resolved) : join(homeDir, ".hasna", "repos");
}
