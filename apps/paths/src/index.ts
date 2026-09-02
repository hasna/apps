/**
 * @hasna/paths — package-owned path resolver for Hasna apps.
 *
 * Resolves the home directories Hasna apps read and write, honoring
 * HASNA_*_HOME, then XDG_*_HOME environment overrides and platform defaults:
 *
 *   config   HASNA_CONFIG_HOME    ~/.config/hasna/<app>
 *   data     HASNA_DATA_HOME      ~/.local/share/hasna/<app>
 *   state    HASNA_STATE_HOME     ~/.local/state/hasna/<app>
 *   cache    HASNA_CACHE_HOME     ~/.cache/hasna/<app>
 *
 * Explicit XDG roots contain `hasna/<app>`. On macOS, when neither override
 * applies, the XDG defaults are replaced by the existing native layout:
 *
 *   config/data   ~/Library/Application Support/Hasna/<app>
 *   cache         ~/Library/Caches/Hasna/<app>
 *   state         ~/Library/Logs/Hasna/<app>
 *
 * Internal apps (`internal: true`) resolve under `hasna/internal/<app>`
 * beneath the same four roots — the same layout, one level deeper — which
 * retires the legacy `~/.hasna` internal home prefix as a concept.
 *
 * `HASNA_<KIND>_HOME` names the
 * hasna-level base root and the app slug is appended, e.g.
 * `HASNA_CONFIG_HOME=/srv/cfg` -> `/srv/cfg/<app>`. An env var that is set
 * but empty is treated as unset. Nonempty HASNA roots must be absolute,
 * without surrounding whitespace or control characters; invalid values
 * fail closed. Empty/relative XDG roots are ignored per the XDG spec.
 *
 * Everything is pure and injectable (`home`, `platform`, `env`) so the
 * resolver is deterministic in tests and portable across machines.
 */

import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** The four path kinds a Hasna app may own. */
export type PathKind = "config" | "data" | "state" | "cache";

/** All four kinds, in stable order. */
export const PATH_KINDS: readonly PathKind[] = ["config", "data", "state", "cache"] as const;

const KIND_ENV: Record<PathKind, string> = {
  config: "HASNA_CONFIG_HOME",
  data: "HASNA_DATA_HOME",
  state: "HASNA_STATE_HOME",
  cache: "HASNA_CACHE_HOME",
};

const XDG_ENV: Record<PathKind, string> = {
  config: "XDG_CONFIG_HOME",
  data: "XDG_DATA_HOME",
  state: "XDG_STATE_HOME",
  cache: "XDG_CACHE_HOME",
};

export interface PathsOptions {
  /** App slug (kebab-case), e.g. `todos` or `mailery`. Required. */
  app: string;
  /**
   * Internal apps resolve under `hasna/internal/<app>` beneath the same
   * four roots. Default `false`.
   */
  internal?: boolean;
  /** Platform override (default `process.platform`) — injected for tests. */
  platform?: NodeJS.Platform;
  /** Home dir override (default `os.homedir()`) — injected for tests. */
  home?: string;
  /** Env override (default `process.env`) — injected for tests. */
  env?: Record<string, string | undefined>;
}

export interface PathsRoots {
  config: string;
  data: string;
  state: string;
  cache: string;
}

const APP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertApp(app: string): void {
  if (typeof app !== "string" || app.length === 0) {
    throw new TypeError("paths: app must be a non-empty string");
  }
  if (!APP_SLUG_RE.test(app)) {
    throw new TypeError(
      `paths: invalid app slug "${app}" — expected lowercase kebab-case ([a-z0-9]+(-[a-z0-9]+)*)`,
    );
  }
}

/**
 * Fail closed on an unknown path kind. The `PathKind` union only protects
 * TypeScript callers; a JS caller or runtime misconfiguration can pass any
 * string, and before this guard `baseDir` silently returned `undefined` for
 * an unknown kind while `resolvePath` threw a cryptic `Path must be a
 * string` from `node:path`. Both now fail loudly, naming the bad kind.
 */
function assertKind(kind: PathKind): void {
  if (!(PATH_KINDS as readonly string[]).includes(kind)) {
    throw new TypeError(
      `paths: invalid path kind "${kind}" — expected one of ${PATH_KINDS.join(", ")}`,
    );
  }
}

function envOf(options: PathsOptions): Record<string, string | undefined> {
  return options.env ?? process.env;
}

/** The env override for one kind, or undefined when unset or empty. */
function envValue(options: PathsOptions, kind: PathKind): string | undefined {
  const key = KIND_ENV[kind];
  const value = envOf(options)[key];
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (!isAbsolute(value) || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value)) {
    // Never include the configured value: roots can contain private records.
    throw new TypeError(`paths: ${key} must be an absolute path without surrounding whitespace or control characters`);
  }
  return value;
}

function isMacOS(platform: NodeJS.Platform): boolean {
  return platform === "darwin";
}

/**
 * The hasna-level base root for one kind, before the app segment is
 * appended. HASNA overrides win, then valid XDG roots, on every platform.
 */
export function baseDir(kind: PathKind, options: PathsOptions): string {
  assertKind(kind);
  const override = envValue(options, kind);
  if (override) return override;

  const xdg = envOf(options)[XDG_ENV[kind]];
  // XDG Base Directory Specification 0.8: ignore relative/empty roots.
  // Do not trim: spaces within an absolute XDG path are valid path data.
  if (typeof xdg === "string" && isAbsolute(xdg) && !xdg.includes("\0")) {
    return join(xdg, "hasna");
  }

  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;

  if (isMacOS(platform)) {
    switch (kind) {
      case "config":
      case "data":
        return join(home, "Library", "Application Support", "Hasna");
      case "cache":
        return join(home, "Library", "Caches", "Hasna");
      case "state":
        return join(home, "Library", "Logs", "Hasna");
    }
  }

  switch (kind) {
    case "config":
      return join(home, ".config", "hasna");
    case "data":
      return join(home, ".local", "share", "hasna");
    case "state":
      return join(home, ".local", "state", "hasna");
    case "cache":
      return join(home, ".cache", "hasna");
  }
}

/** Resolve the directory for one path kind for an app. */
export function resolvePath(kind: PathKind, options: PathsOptions): string {
  assertKind(kind);
  assertApp(options.app);
  const appSegment = options.internal === true ? join("internal", options.app) : options.app;
  return join(baseDir(kind, options), appSegment);
}

/** The config home for an app. */
export function configDir(options: PathsOptions): string {
  return resolvePath("config", options);
}

/** The data home for an app. */
export function dataDir(options: PathsOptions): string {
  return resolvePath("data", options);
}

/** The state home for an app. */
export function stateDir(options: PathsOptions): string {
  return resolvePath("state", options);
}

/** The cache home for an app. */
export function cacheDir(options: PathsOptions): string {
  return resolvePath("cache", options);
}

/** Resolve all four homes for one app. */
export function dirs(options: PathsOptions): PathsRoots {
  return {
    config: configDir(options),
    data: dataDir(options),
    state: stateDir(options),
    cache: cacheDir(options),
  };
}
