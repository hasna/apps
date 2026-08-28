import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
// --- Local path resolver -------------------------------------------------
// @hasna/paths was deleted (hasna/apps#1535, 2026-09-03); this in-package
// implementation preserves the resolver contract (XDG / macOS home layout
// honoring HASNA_{CONFIG,DATA,STATE,CACHE}_HOME, with the same env-override
// and home-override semantics the deleted package had).
import { homedir as pathsResolverHomedir } from "node:os";
import { join as pathsResolverJoin } from "node:path";

export type PathKind = "config" | "data" | "state" | "cache";

const PATHS_RESOLVER_KIND_ENV: Record<PathKind, string> = {
  config: "HASNA_CONFIG_HOME",
  data: "HASNA_DATA_HOME",
  state: "HASNA_STATE_HOME",
  cache: "HASNA_CACHE_HOME",
};

export interface PathsResolverOptions {
  app: string;
  internal?: boolean;
  platform?: string;
  home?: string;
  env?: Record<string, string | undefined>;
}

const PATHS_RESOLVER_APP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function pathsResolverAssertApp(app: string): void {
  if (typeof app !== "string" || app.length === 0) {
    throw new TypeError("paths: app must be a non-empty string");
  }
  if (!PATHS_RESOLVER_APP_SLUG_RE.test(app)) {
    throw new TypeError(
      `paths: invalid app slug "${app}" — expected lowercase kebab-case ([a-z0-9]+(-[a-z0-9]+)*)`,
    );
  }
}

function pathsResolverAssertKind(kind: PathKind): void {
  if (!(Object.keys(PATHS_RESOLVER_KIND_ENV) as string[]).includes(kind)) {
    throw new TypeError(
      `paths: invalid path kind "${kind}" — expected one of ${Object.keys(PATHS_RESOLVER_KIND_ENV).join(", ")}`,
    );
  }
}

function pathsResolverBaseDir(kind: PathKind, options: PathsResolverOptions): string {
  pathsResolverAssertKind(kind);
  const env: Record<string, string | undefined> = options.env ?? process.env;
  const override = env[PATHS_RESOLVER_KIND_ENV[kind]];
  if (typeof override === "string" && override.length > 0) return override;
  const home = options.home ?? pathsResolverHomedir();
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    switch (kind) {
      case "config":
      case "data":
        return pathsResolverJoin(home, "Library", "Application Support", "Hasna");
      case "cache":
        return pathsResolverJoin(home, "Library", "Caches", "Hasna");
      case "state":
        return pathsResolverJoin(home, "Library", "Logs", "Hasna");
    }
  }
  switch (kind) {
    case "config":
      return pathsResolverJoin(home, ".config", "hasna");
    case "data":
      return pathsResolverJoin(home, ".local", "share", "hasna");
    case "state":
      return pathsResolverJoin(home, ".local", "state", "hasna");
    case "cache":
      return pathsResolverJoin(home, ".cache", "hasna");
  }
}

function pathsResolverResolve(kind: PathKind, options: PathsResolverOptions): string {
  pathsResolverAssertApp(options.app);
  const appSegment = options.internal === true ? pathsResolverJoin("internal", options.app) : options.app;
  return pathsResolverJoin(pathsResolverBaseDir(kind, options), appSegment);
}
export function dataDir(options: PathsResolverOptions): string {
  return pathsResolverResolve("data", options);
}

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
  legacyRoot?: string,
): boolean {
  // Already physically migrated: the resolver root holds the store — adopt.
  if (existsSync(join(resolved, "repos.db"))) return true;
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) {
    // Deliberate opt-in to the XDG layout — but never render a live legacy
    // store invisible: with repos.db still at the legacy root and none at the
    // resolver root yet, adopting would create an empty resolver database
    // that hides the real store and makes the switch persist after the
    // override is unset. The operator physically migrates the store (move or
    // copy repos.db) for the override to take effect.
    //
    // The legacy root is compared against the SAME home the resolver root was
    // computed from: an explicit-home caller (`getDataRootForHome`) must not
    // have its live store judged against `env.HOME`'s legacy root, which may
    // belong to a different machine layout entirely.
    const legacy = legacyRoot ?? getLegacyDataRoot(env);
    return !existsSync(join(legacy, "repos.db"));
  }
  return false;
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
  const legacyRoot = join(homeDir, ".hasna", "repos");
  return adoptResolverDataRoot(resolved, env, legacyRoot) ? resolve(resolved) : legacyRoot;
}
