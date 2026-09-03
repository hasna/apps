/**
 * Monitor home resolution — the effective local home for the monitor package,
 * resolved through @hasna/paths.
 *
 * Resolution order:
 *   1. exact-app override — `MONITOR_CONFIG_DIR` (the shipped override), then
 *      the wave-convention alias `HASNA_MONITOR_HOME` — wins unconditionally;
 *   2. the @hasna/paths data home (XDG / macOS home layout) once adopted;
 *   3. otherwise the legacy `~/.hasna/monitor` default.
 *
 * Gated legacy adoption: the legacy `~/.hasna/monitor` home stays effective
 * until the store has actually been migrated to the XDG data home (a
 * `config.json` or `monitor.db` exists at the resolver home) or the operator
 * sets the data-kind override `HASNA_DATA_HOME`. An existing local store never
 * becomes invisible on upgrade.
 */

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

/** Env var name for the exact-app home alias that follows the wave convention. */
export const HASNA_MONITOR_HOME_ENV = "HASNA_MONITOR_HOME";

/**
 * The effective user home, honoring a runtime `HOME` override. `os.homedir()`
 * snapshots `HOME` at process start and (under Bun) ignores later
 * reassignment, so tests that set `process.env.HOME` to a temp dir would
 * otherwise resolve the *real* home. In production `HOME` is set at startup,
 * so this resolves identically.
 */
export function effectiveHome(): string {
  return process.env["HOME"] || homedir();
}

/** Pre-XDG default home: `~/.hasna/monitor`. */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "monitor");
}

/**
 * The @hasna/paths-resolved data home for monitor (XDG / macOS home layout).
 * The home override mirrors the pre-existing `$HOME`-first resolution so the
 * resolver follows the same home the legacy path does.
 */
export function resolverHome(): string {
  return dataDir({
    app: "monitor",
    home: process.env["HOME"] || undefined,
  });
}

/**
 * Whether the resolver (XDG) home should be adopted as the monitor home.
 * The resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the
 * store has already been physically migrated there (`config.json` or
 * `monitor.db` exists). A machine that only redirects another kind (e.g. cache
 * to tmpfs) must NOT have its data home moved, and a live store at the legacy
 * home must never become invisible on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return (
    existsSync(join(resolved, "config.json")) ||
    existsSync(join(resolved, "monitor.db"))
  );
}

/**
 * The exact-app override root, when set: the shipped `MONITOR_CONFIG_DIR`
 * wins; `HASNA_MONITOR_HOME` is the wave-convention alias.
 */
export function exactMonitorDir(): string | undefined {
  const dir = process.env["MONITOR_CONFIG_DIR"];
  if (dir && dir.trim()) return dir.trim();
  const home = process.env[HASNA_MONITOR_HOME_ENV];
  if (home && home.trim()) return home.trim();
  return undefined;
}

/** Whether an exact-app override root is set (used to skip legacy migration). */
export function hasExactMonitorOverride(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env["MONITOR_CONFIG_DIR"]?.trim()) || Boolean(env[HASNA_MONITOR_HOME_ENV]?.trim());
}

/**
 * Effective monitor home: an exact-app override (`MONITOR_CONFIG_DIR`, then
 * the `HASNA_MONITOR_HOME` alias) wins unconditionally; otherwise the resolver
 * (XDG) data home once adopted; otherwise the legacy `~/.hasna/monitor`
 * default.
 */
export function getMonitorDir(): string {
  const exact = exactMonitorDir();
  if (exact) return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(legacyHomeDir());
}
