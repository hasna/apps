/**
 * The single paths resolver for the Hasna fleet.
 *
 * Ruling hasna/apps#1668 (2026-09-04): one resolver lives here — in
 * `@hasna/contracts` — and every app resolves its local data/config/state/
 * cache roots through it. Apps must NOT reimplement or embed this logic
 * (repo-conformance check: tooling/ci/tests/standard/paths-conformance.test.ts
 * fails on copies) and must NOT hard-code `.hasna/<app>` or
 * `Application Support` literals.
 *
 * Placement (ruled):
 *   - macOS (`darwin`): every kind resolves under `~/.hasna/<app>/` — the
 *     layout every station wrapper, the `.hasna/projects` rule and the home
 *     taxonomy assume.
 *   - other platforms: XDG — `~/.config/hasna/<app>` (config),
 *     `~/.local/share/hasna/<app>` (data), `~/.local/state/hasna/<app>`
 *     (state), `~/.cache/hasna/<app>` (cache).
 *
 * Overrides (kind-level, same semantics the deleted @hasna/paths had):
 * `HASNA_CONFIG_HOME` / `HASNA_DATA_HOME` / `HASNA_STATE_HOME` /
 * `HASNA_CACHE_HOME` win unconditionally over the platform layout.
 * Per-app exact-app overrides (`HASNA_<APP>_HOME`, `MONITOR_CONFIG_DIR`, …)
 * are app-level policy layered on top by each app's thin wrapper; the
 * resolver itself only knows kind-level overrides and the app slug.
 *
 * Hosted mode must not create local data directories at all (hasna/apps#1613);
 * this resolver only matters for local placement and caches.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export type PathKind = "config" | "data" | "state" | "cache";

/** The kind-level override env vars, in resolver order. */
export const PATH_KIND_ENV: Readonly<Record<PathKind, string>> = {
  config: "HASNA_CONFIG_HOME",
  data: "HASNA_DATA_HOME",
  state: "HASNA_STATE_HOME",
  cache: "HASNA_CACHE_HOME",
};

export interface PathsResolverOptions {
  /** Lowercase kebab-case app slug (`[a-z0-9]+(-[a-z0-9]+)*`). */
  app: string;
  /** Nest under `internal/<app>` (kept for @hasna/paths parity; unused today). */
  internal?: boolean;
  /** Override the OS platform (tests). Defaults to `process.platform`. */
  platform?: string;
  /** Override the home directory. Defaults to `effectiveHome()`. */
  home?: string;
  /** Override the environment. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

const PATHS_RESOLVER_APP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertApp(app: string): void {
  if (typeof app !== "string" || app.length === 0) {
    throw new TypeError("paths: app must be a non-empty string");
  }
  if (!PATHS_RESOLVER_APP_SLUG_RE.test(app)) {
    throw new TypeError(
      `paths: invalid app slug "${app}" — expected lowercase kebab-case ([a-z0-9]+(-[a-z0-9]+)*)`,
    );
  }
}

function assertKind(kind: PathKind): void {
  if (!(Object.keys(PATH_KIND_ENV) as string[]).includes(kind)) {
    throw new TypeError(
      `paths: invalid path kind "${kind}" — expected one of ${Object.keys(PATH_KIND_ENV).join(", ")}`,
    );
  }
}

/**
 * Resolve the user's home directory: `$HOME`, then `$USERPROFILE` (Windows),
 * then the OS user database. A home that cannot be resolved is a hard error —
 * never a literal "~" path (relative to cwd) and never an
 * "undefined"-prefixed path.
 */
export function effectiveHome(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (!home) {
    throw new Error("Unable to resolve the user's home directory");
  }
  return home;
}

/** The kind-level override env var for a path kind, e.g. `HASNA_DATA_HOME`. */
export function kindEnv(kind: PathKind): string {
  assertKind(kind);
  return PATH_KIND_ENV[kind];
}

/**
 * The base directory for a path kind: the `HASNA_<KIND>_HOME` override when
 * set, otherwise the ruled platform layout — `~/.hasna` on macOS, XDG on
 * other platforms. The app slug is NOT part of the base.
 */
export function baseDir(kind: PathKind, options: PathsResolverOptions): string {
  assertKind(kind);
  const env: Record<string, string | undefined> = options.env ?? process.env;
  const override = env[PATH_KIND_ENV[kind]];
  if (typeof override === "string" && override.length > 0) return override;
  const home = options.home ?? effectiveHome(options.env);
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    // Ruling #1668: ~/.hasna/<app>/ on every platform (macOS included).
    return join(home, ".hasna");
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

/**
 * Resolve a kind root for an app: `baseDir` + the app segment
 * (`internal/<app>` when `options.internal`).
 */
export function resolveDir(kind: PathKind, options: PathsResolverOptions): string {
  assertKind(kind);
  assertApp(options.app);
  const appSegment = options.internal === true ? join("internal", options.app) : options.app;
  return join(baseDir(kind, options), appSegment);
}

/** The local data root for an app: `~/.hasna/<app>` (macOS) / XDG data (Linux). */
export function dataDir(options: PathsResolverOptions): string {
  return resolveDir("data", options);
}

/** The local config root for an app. */
export function configDir(options: PathsResolverOptions): string {
  return resolveDir("config", options);
}

/** The local state root for an app. */
export function stateDir(options: PathsResolverOptions): string {
  return resolveDir("state", options);
}

/** The local cache root for an app. */
export function cacheDir(options: PathsResolverOptions): string {
  return resolveDir("cache", options);
}