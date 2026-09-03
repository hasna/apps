import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
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
export function resolverDataDir(options: PathsResolverOptions): string {
  return pathsResolverResolve("data", options);
}

/** Env var name for the exact-app data-home override. */
export const DISPATCH_DATA_DIR_ENV = "DISPATCH_DATA_DIR";

/**
 * The effective user home, mirroring the pre-existing dispatch resolution
 * (`HOME` || `USERPROFILE` || `os.homedir()`). Read at call time because the
 * config/CLI tests switch `$HOME` mid-process and bun's `os.homedir()` does
 * not follow that switch. A home that cannot be resolved is a hard error —
 * never a literal "~" path (relative to cwd) and never an
 * "undefined"-prefixed path.
 */
export function getHomeDir(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  if (!home) throw new Error("Could not resolve the user home directory");
  return home;
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data dir for dispatch.
 * This is the forward-looking home the XDG migration (hotfixes plan 0f49f56a,
 * task P3.3) moves the store toward: `~/.local/share/hasna/dispatch` on Linux,
 * `~/Library/Application Support/Hasna/dispatch` on macOS. The home override
 * mirrors the pre-existing $HOME-first resolution so the resolver follows the
 * same home the legacy path does.
 */
export function getResolverDataDir(): string {
  return resolverDataDir({ app: "dispatch", home: getHomeDir() });
}

/** The legacy (pre-XDG) data dir: ~/.hasna/dispatch */
export function getLegacyDataDir(): string {
  return join(getHomeDir(), ".hasna", "dispatch");
}

/**
 * Whether the resolver (XDG) data dir should be adopted as the effective data
 * dir. The resolver dir is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`dispatch.db` exists). A machine that only redirects another kind (e.g.
 * cache to tmpfs) must NOT have its data home moved, and a live store at the
 * legacy home must never become invisible on upgrade.
 */
export function adoptResolverDataDir(
  resolved: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "dispatch.db"));
}

/** The exact-app override root, when set: `DISPATCH_DATA_DIR`. */
export function getExactDataDir(): string | undefined {
  const dir = process.env[DISPATCH_DATA_DIR_ENV];
  if (dir && dir.trim()) return dir.trim();
  return undefined;
}

/**
 * The effective dispatch data dir: an exact-app override (`DISPATCH_DATA_DIR`)
 * wins unconditionally; otherwise the resolver (XDG) data dir once adopted
 * (`HASNA_DATA_HOME` set, or `dispatch.db` already migrated there); otherwise
 * the legacy `~/.hasna/dispatch` default — an existing store never becomes
 * invisible on upgrade.
 */
export function getDataDir(): string {
  const exact = getExactDataDir();
  if (exact) return resolve(exact);
  const resolved = getResolverDataDir();
  return adoptResolverDataDir(resolved) ? resolve(resolved) : resolve(getLegacyDataDir());
}

/** Root data directory for @hasna/dispatch state. */
export function dataDir(): string {
  return getDataDir();
}

/** Path to the sqlite database file. */
export function dbPath(): string {
  return join(dataDir(), "dispatch.db");
}

/** Path to the daemon pid file. */
export function pidFilePath(): string {
  return join(dataDir(), "daemon.pid");
}

/** Path to the daemon log file. */
export function daemonLogPath(): string {
  return join(dataDir(), "daemon.log");
}

/** Path to the daemon heartbeat/state file. */
export function daemonStatePath(): string {
  return join(dataDir(), "daemon.state.json");
}

/** Directory used as an atomic daemon pidfile lock. */
export function daemonPidLockPath(): string {
  return join(dataDir(), "daemon.pid.lock");
}

/** Directory for bounded, redacted artifacts written by agent abstractions. */
export function artifactsDir(): string {
  return join(dataDir(), "artifacts");
}
