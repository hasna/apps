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
 * @hasna/mementos data-home resolution through the @hasna/paths resolver.
 *
 * mementos stores its sqlite database (`mementos.db`), `config.json`, the
 * per-agent `agents/`, `profiles/`, `training/` and `backups/` data and the
 * remote-storage `storage/config.json` under a single data root. Historically
 * that root was `~/.hasna/mementos`. This module resolves the root through
 * `@hasna/paths` (XDG / macOS home layout) with a gated legacy adoption: the
 * legacy `~/.hasna/mementos` stays the effective data root until the store is
 * physically migrated to the XDG data home (`mementos.db` present there) or
 * the operator sets the data-kind override `HASNA_DATA_HOME`. An existing
 * live store never becomes invisible on upgrade. The exact-app overrides
 * `HASNA_MEMENTOS_HOME` (then `MEMENTOS_HOME`) win unconditionally, and the
 * db-path overrides (`HASNA_MEMENTOS_DB_PATH` / `MEMENTOS_DB_PATH`) stay
 * layered on top by `getDbPath`.
 *
 * Nothing moves on disk in this phase — the package just resolves the new
 * paths.
 */

/** The effective user home, mirroring the pre-existing mementos resolution (`HOME` || `USERPROFILE`). */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir() || "/tmp";
}

/** The legacy (pre-XDG) data root: `~/.hasna/mementos`. */
export function legacyDataRoot(): string {
  return join(effectiveHome(), ".hasna", "mementos");
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for mementos:
 * `~/.local/share/hasna/mementos` on Linux, `~/Library/Application
 * Support/Hasna/mementos` on macOS. The home override mirrors the pre-existing
 * `$HOME`-first resolution so the resolver follows the same home the legacy
 * path does.
 */
export function resolverDataRoot(): string {
  return dataDir({
    app: "mementos",
    home: process.env["HOME"] || process.env["USERPROFILE"] || undefined,
  });
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective
 * data root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`mementos.db` exists — mementos' store file). A machine that only
 * redirects another kind (e.g. cache to tmpfs) must NOT have its data home
 * moved, and a live store at the legacy home must never become invisible on
 * upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "mementos.db"));
}

/** The exact-app override root, when set: `HASNA_MEMENTOS_HOME`, then `MEMENTOS_HOME`. */
export function exactDataRoot(): string | undefined {
  // First non-blank override wins. A blank or whitespace-only primary must not
  // shadow a valid secondary (nullish `??` does not fall through on "").
  for (const key of ["HASNA_MEMENTOS_HOME", "MEMENTOS_HOME"] as const) {
    const dir = process.env[key]?.trim();
    if (dir) return resolve(dir);
  }
  return undefined;
}

/**
 * The effective data root: an exact-app override (`HASNA_MEMENTOS_HOME`, then
 * `MEMENTOS_HOME`) wins unconditionally; otherwise the resolver (XDG) data
 * root once adopted; otherwise the legacy `~/.hasna/mementos` default.
 */
export function getDataRoot(): string {
  const exact = exactDataRoot();
  if (exact) return exact;
  const resolved = resolverDataRoot();
  return adoptResolverDataRoot(resolved) ? resolve(resolved) : resolve(legacyDataRoot());
}
