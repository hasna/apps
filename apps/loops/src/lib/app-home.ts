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

/** Env var name for the exact-app data-dir alias that follows the wave convention. */
export const HASNA_LOOPS_DATA_DIR_ENV = "HASNA_LOOPS_DATA_DIR";

/**
 * The effective user home, mirroring the pre-existing loops resolution
 * (`HOME` || `os.homedir()`). Read at call time because the daemon/CLI tests
 * switch `$HOME` mid-process and bun's `os.homedir()` does not follow that
 * switch.
 */
export function effectiveHome(): string {
  return process.env["HOME"] || homedir();
}

/**
 * Pre-XDG default home: `~/.hasna/loops`. Resolved at call time (not module
 * load) so switching `$HOME` mid-process keeps working.
 */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "loops");
}

/**
 * The @hasna/paths-resolved data home for loops (XDG / macOS home layout).
 * The home override mirrors the pre-existing `$HOME`-first resolution so the
 * resolver follows the same home the legacy path does.
 */
export function resolverHome(): string {
  return dataDir({
    app: "loops",
    home: process.env["HOME"] || undefined,
  });
}

/**
 * Whether the resolver (XDG) home should be adopted as the loops data home.
 * The resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the
 * store has already been physically migrated there (`loops.db` exists). A
 * machine that only redirects another kind (e.g. cache to tmpfs) must NOT have
 * its data home moved, and a live store at the legacy home must never become
 * invisible on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "loops.db"));
}

/**
 * The exact-app override root, when set: the shipped `LOOPS_DATA_DIR` wins;
 * `HASNA_LOOPS_DATA_DIR` is the wave-convention alias.
 */
export function exactLoopsDataDir(): string | undefined {
  const dir = process.env["LOOPS_DATA_DIR"];
  if (dir && dir.trim()) return dir.trim();
  const home = process.env[HASNA_LOOPS_DATA_DIR_ENV];
  if (home && home.trim()) return home.trim();
  return undefined;
}

/**
 * Effective loops data home: an exact-app override (`LOOPS_DATA_DIR`, then the
 * `HASNA_LOOPS_DATA_DIR` alias) wins unconditionally; otherwise the resolver
 * (XDG) data home once adopted; otherwise the legacy `~/.hasna/loops` default.
 */
export function getLoopsDataDir(): string {
  const exact = exactLoopsDataDir();
  if (exact) return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(legacyHomeDir());
}
