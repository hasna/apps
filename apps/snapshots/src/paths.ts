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
 * @hasna/snapshots home resolution.
 *
 * @hasna/snapshots stores its sqlite db (`snapshots.sqlite`, WAL sidecars)
 * and its exports / logs / plans subdirectories under a single data home.
 * Historically that home was `~/.hasna/snapshots`. This module resolves it
 * through `@hasna/paths` (XDG / macOS home layout) with a gated legacy
 * adoption: the legacy `~/.hasna/snapshots` stays the effective home until
 * the store is physically migrated to the XDG data home or the operator sets
 * the data-kind override `HASNA_DATA_HOME`. An existing live store never
 * becomes invisible on upgrade. The exact-app override `HASNA_SNAPSHOTS_DIR`
 * (the pre-existing per-app data-dir override) wins unconditionally; the
 * store-path override `HASNA_SNAPSHOTS_DB_PATH` is layered on top of the
 * effective home by `defaultDbPath`.
 */

/** Resolve the user's home directory: $HOME, then $USERPROFILE (Windows), then the OS user database. */
export function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (!home) {
    throw new Error("Unable to resolve the user's home directory");
  }
  return home;
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data home for
 * snapshots. This is the forward-looking home the XDG migration (hotfixes
 * plan 0f49f56a, task P3.3) moves the store toward:
 * `~/.local/share/hasna/snapshots` on Linux,
 * `~/Library/Application Support/Hasna/snapshots` on macOS. The home override
 * mirrors the pre-existing $HOME-first resolution so the resolver follows the
 * same home the legacy path does.
 */
export function getResolverDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return dataDir({ app: "snapshots", home: getHomeDir(env), env });
}

/** The legacy (pre-XDG) data home: ~/.hasna/snapshots */
export function getLegacyDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", "snapshots");
}

/**
 * Whether the resolver (XDG) data home should be adopted as the effective
 * data home. The resolver home is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`snapshots.sqlite` exists). A machine that only redirects another kind
 * (e.g. cache to tmpfs) must NOT have its data home moved, and a live store
 * at the legacy home must never become invisible on upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "snapshots.sqlite"));
}

/** The exact-app override root, when set: `HASNA_SNAPSHOTS_DIR`. */
export function getExactDataRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env["HASNA_SNAPSHOTS_DIR"];
  if (dir && dir.trim()) return resolve(dir.trim());
  return undefined;
}

/**
 * The effective data home: an exact-app override (`HASNA_SNAPSHOTS_DIR`) wins
 * unconditionally; otherwise the resolver (XDG) data home once adopted;
 * otherwise the legacy `~/.hasna/snapshots` default. The store path
 * (`HASNA_SNAPSHOTS_DB_PATH`) is layered on top of this by `defaultDbPath`,
 * so an explicit store path always wins regardless.
 */
export function getDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const exact = getExactDataRoot(env);
  if (exact) return exact;
  const resolved = getResolverDataRoot(env);
  return adoptResolverDataRoot(resolved, env) ? resolve(resolved) : getLegacyDataRoot(env);
}

/**
 * The default sqlite store path: `HASNA_SNAPSHOTS_DB_PATH` (the pre-existing
 * exact store override) wins unconditionally; otherwise `snapshots.sqlite`
 * under the effective data home.
 */
export function getDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const store = env["HASNA_SNAPSHOTS_DB_PATH"];
  if (store && store.trim()) return resolve(store.trim());
  return join(getDataRoot(env), "snapshots.sqlite");
}
