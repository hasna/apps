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
export function configDir(options: PathsResolverOptions): string {
  return pathsResolverResolve("config", options);
}

/**
 * Configs-app store-home resolution via the @hasna/paths resolver (XDG / macOS
 * home layout). The "configs" app is the @hasna/instructions package surface
 * that ships the `configs` / `configs-mcp` aliases and owns the configs store
 * (SQLite store, backups, station-profile cache). Every shipped local-storage
 * path derives from the effective store home.
 *
 * The legacy `~/.hasna/instructions` default (with the `HASNA_CONFIGS_HOME`
 * exact-app override) stays the effective store home until the store has
 * actually been migrated to the XDG config home or the operator sets the
 * config-kind override `HASNA_CONFIG_HOME` — an existing local store never
 * becomes invisible on upgrade.
 */
export const HASNA_CONFIGS_HOME_ENV = "HASNA_CONFIGS_HOME";

function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env["HOME"] || env["USERPROFILE"] || homedir();
}

/** Pre-XDG default store home: ~/.hasna/instructions (computed at call time; HOME may be redirected). */
export function legacyStoreHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(join(homeDir(env), ".hasna", "instructions"));
}

/**
 * The @hasna/paths-resolved config home for the configs app (XDG layout):
 * ~/.config/hasna/configs on Linux; ~/Library/Application
 * Support/Hasna/configs on macOS.
 */
export function resolverStoreHome(env: NodeJS.ProcessEnv = process.env): string {
  return configDir({ app: "configs", env, home: env.HOME || env.USERPROFILE || homedir() });
}

/**
 * Whether the resolver (XDG) home should be adopted as the store home. The
 * resolver home is adopted only when the operator has set `HASNA_CONFIG_HOME`
 * (the config-kind override — a deliberate opt-in to the XDG layout) or the
 * store has already been physically migrated there (`instructions.db` exists at
 * the resolver home). A machine that only redirects another kind must NOT have
 * its configs store moved, and a live store at the legacy home must never
 * become invisible on upgrade.
 */
export function adoptResolverStoreHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const override = env.HASNA_CONFIG_HOME;
  if (typeof override === "string" && override.trim().length > 0) return true;
  return existsSync(join(resolved, "instructions.db"));
}

/** The exact-app override root: `HASNA_CONFIGS_HOME`. Empty values are treated as unset. */
export function exactStoreHome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = env[HASNA_CONFIGS_HOME_ENV];
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * Effective configs store home: the exact-app override (`HASNA_CONFIGS_HOME`)
 * wins unconditionally; otherwise the @hasna/paths config home once adopted
 * (`HASNA_CONFIG_HOME` set or the store already migrated there); otherwise the
 * legacy `~/.hasna/instructions` default, so an existing store never becomes
 * invisible on upgrade.
 */
export function getConfigsStoreHome(env: NodeJS.ProcessEnv = process.env): string {
  const exact = exactStoreHome(env);
  if (exact) return resolve(exact);
  const resolved = resolverStoreHome(env);
  return adoptResolverStoreHome(resolved, env) ? resolve(resolved) : legacyStoreHome(env);
}

/** The store's SQLite database path under the effective store home. */
export function getConfigsStoreDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getConfigsStoreHome(env), "instructions.db");
}

/**
 * The local database path surfaced by server status/health surfaces (e.g. the
 * MCP server's `db_path` field). The exact `HASNA_INSTRUCTIONS_DB_PATH`
 * override wins; otherwise the resolver-derived store db path (legacy
 * `~/.hasna/instructions/instructions.db` until the XDG config home is
 * adopted, matching `db/database.ts`). A server status must never hardcode the
 * legacy literal — the store can live at the resolver home.
 */
export function getReportedDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["HASNA_INSTRUCTIONS_DB_PATH"];
  if (typeof override === "string" && override.length > 0) return override;
  return getConfigsStoreDbPath(env);
}
