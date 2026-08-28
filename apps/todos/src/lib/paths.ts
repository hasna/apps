import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

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
