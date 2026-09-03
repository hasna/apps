import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
export function pathsDataDir(options: PathsResolverOptions): string {
  return pathsResolverResolve("data", options);
}

/** Env override names, in precedence order. */
export const HASNA_RELEASES_HOME_ENV = "HASNA_RELEASES_HOME";
export const RELEASES_HOME_ENV = "RELEASES_HOME";
export const RELEASES_DATA_DIR_ENV = "RELEASES_DATA_DIR";

/**
 * Pre-XDG default home: ~/.hasna/releases. Stays the effective data dir until
 * the resolver (XDG) home is adopted, so an existing store and its layout never
 * become invisible on upgrade.
 */
export const DEFAULT_DATA_DIR = join(homedir(), ".hasna", "releases");

/** The @hasna/paths-resolved data home for releases (XDG layout). */
export function resolverHome(): string {
  return pathsDataDir({ app: "releases" });
}

/**
 * Whether the resolver (XDG) home should be adopted as the data dir. The
 * resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the store
 * has already been physically migrated there (`releases.db` exists). A machine
 * that only redirects another kind (e.g. cache to tmpfs) must NOT have its data
 * home moved, and a live store at the legacy home must never become invisible
 * on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "releases.db"));
}

/**
 * The exact-app override root, when set: `HASNA_RELEASES_HOME` wins over
 * `RELEASES_HOME`, which wins over the long-documented `RELEASES_DATA_DIR`.
 */
export function exactReleasesHome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of [HASNA_RELEASES_HOME_ENV, RELEASES_HOME_ENV, RELEASES_DATA_DIR_ENV]) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/**
 * Effective data dir: an explicit `dataDir` argument wins; otherwise an
 * exact-app override (`HASNA_RELEASES_HOME`, `RELEASES_HOME`, or the legacy
 * `RELEASES_DATA_DIR`) wins unconditionally; otherwise the resolver data home
 * once adopted; otherwise the legacy `~/.hasna/releases` default.
 */
export function resolveDataDir(dataDirOverride?: string): string {
  const resolved =
    dataDirOverride?.trim() ||
    exactReleasesHome() ||
    (adoptResolverHome(resolverHome()) ? resolverHome() : DEFAULT_DATA_DIR);
  mkdirSync(resolved, { recursive: true });
  return resolved;
}

export function ledgerDbPath(dataDir?: string): string {
  return join(resolveDataDir(dataDir), "releases.db");
}

export function outboxPath(dataDir?: string): string {
  return join(resolveDataDir(dataDir), "outbox.jsonl");
}

export function eventsDataDir(dataDir?: string): string {
  return join(resolveDataDir(dataDir), "events");
}
