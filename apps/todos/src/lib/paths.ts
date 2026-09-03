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
 * The effective user home, honoring a runtime `HOME` override. `os.homedir()`
 * snapshots `HOME` at process start and (under Bun) ignores later
 * reassignment, so tests that set `process.env.HOME` to a temp dir would
 * otherwise resolve the *real* home. In production `HOME` is set at startup,
 * so this resolves identically.
 */
export function effectiveHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME || env.USERPROFILE || homedir();
}

/** Pre-XDG default data home: `~/.hasna/todos`. */
export function legacyHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(effectiveHome(env), ".hasna", "todos");
}

/**
 * The @hasna/paths-resolved data home for todos (XDG / macOS home layout).
 * The home override mirrors the pre-existing $HOME-first resolution so the
 * resolver follows the same home the legacy path does.
 */
export function resolverHome(env: NodeJS.ProcessEnv = process.env): string {
  return dataDir({ app: "todos", home: effectiveHome(env), env });
}

/**
 * Whether the resolver (XDG) data home should be adopted as the todos data
 * home. Adopted only when the operator sets `HASNA_DATA_HOME` (the data-kind
 * override — a deliberate opt-in to the XDG layout) or the store has already
 * been physically migrated there (`todos.db` or `config.json` exists at the
 * resolver home). A live store at the legacy home must never become invisible
 * on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return (
    existsSync(join(resolved, "todos.db")) ||
    existsSync(join(resolved, "config.json"))
  );
}

/**
 * The effective todos data dir: the @hasna/paths (XDG) data home once adopted;
 * otherwise the legacy `~/.hasna/todos` default. The file-level store
 * overrides (`HASNA_TODOS_DB_PATH` / `TODOS_DB_PATH`,
 * `TODOS_SANDBOX_PROFILES_PATH`) are layered on top by the individual store
 * layers and always win regardless.
 */
export function getTodosDir(env: NodeJS.ProcessEnv = process.env): string {
  const resolved = resolverHome(env);
  return resolve(adoptResolverHome(resolved, env) ? resolved : legacyHomeDir(env));
}

/** The default global database file: `<effective data dir>/todos.db`. */
export function getDefaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getTodosDir(env), "todos.db");
}

/** The default training directory: `<effective data dir>/training`. */
export function getTrainingDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(getTodosDir(env), "training");
}

/** The config file: `<effective data dir>/config.json`. */
export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getTodosDir(env), "config.json");
}
