import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
 * Resolve the user's home directory: $HOME, then $USERPROFILE (Windows), then
 * the OS user database. A home that cannot be resolved is a hard error — never
 * a literal "~" path (relative to cwd) and never an "undefined"-prefixed path.
 */
export function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (!home) {
    throw new Error("Unable to resolve the user's home directory");
  }
  return home;
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for files.
 * This is the forward-looking home the XDG migration (hotfixes plan
 * 0f49f56a, task P3.3) moves the store toward: `~/.local/share/hasna/files`
 * on Linux, `~/Library/Application Support/Hasna/files` on macOS. The home
 * override mirrors the pre-existing $HOME-first resolution so the resolver
 * follows the same home the legacy path does.
 */
export function getResolverDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return dataDir({ app: "files", home: getHomeDir(env), env });
}

/** The legacy (pre-XDG) data root: ~/.hasna/files */
export function getLegacyDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", "files");
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective
 * data root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`files.db` exists). A machine that only redirects another kind (e.g.
 * cache to tmpfs) must NOT have its data home moved, and a live store at the
 * legacy home must never become invisible on upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "files.db"));
}

/**
 * The exact-app override root, when set. The existing data-dir overrides
 * (`HASNA_FILES_DATA_DIR`, then `FILES_DATA_DIR`) keep their pre-resolver
 * precedence — they name the whole data root directly — followed by the
 * XDG-style exact-app home overrides `HASNA_FILES_HOME`, then `FILES_HOME`.
 * First-nonblank selection: a set-but-whitespace override must not suppress
 * a valid fallback. The postinstall script (scripts/ensure-data-dir.mjs)
 * selects with the same `?.trim() ||` semantics, so the two surfaces stay in
 * parity.
 */
export function getExactDataRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dataDirOverride = env["HASNA_FILES_DATA_DIR"]?.trim() || env["FILES_DATA_DIR"]?.trim();
  if (dataDirOverride) return resolve(dataDirOverride);
  const dir = env["HASNA_FILES_HOME"]?.trim() || env["FILES_HOME"]?.trim();
  if (dir) return resolve(dir);
  return undefined;
}

/**
 * The effective data root: an exact-app override (data-dir overrides, then
 * `HASNA_FILES_HOME` / `FILES_HOME`) wins unconditionally; otherwise the
 * resolver (XDG) data root once adopted; otherwise the legacy
 * `~/.hasna/files` default. The store path (`HASNA_FILES_DB_PATH` /
 * `FILES_DB_PATH` / `--db`) is layered on top of this by the database layer,
 * so an explicit store path always wins regardless.
 */
export function getDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const exact = getExactDataRoot(env);
  if (exact) return exact;
  const resolved = getResolverDataRoot(env);
  return adoptResolverDataRoot(resolved, env) ? resolve(resolved) : getLegacyDataRoot(env);
}

/** Alias kept for readability at call sites that want "the files data dir". */
export function getFilesDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return getDataRoot(env);
}

/**
 * The effective data dir, provisioned. Preserves the pre-resolver behavior of
 * `resolveDataDir()` in src/db/database.ts / src/lib/config.ts: the one-time
 * auto-migration copies a legacy `~/.files` data directory into the effective
 * data root when the root does not yet exist. The copy targets the effective
 * root, so an adopted (XDG) install lands the legacy data in the new home.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = getFilesDataDir(env);
  const oldDir = join(getHomeDir(env), ".files");
  if (!existsSync(dir) && existsSync(oldDir)) {
    mkdirSync(dirname(dir), { recursive: true });
    cpSync(oldDir, dir, { recursive: true });
  }
  return dir;
}

/** The effective data dir, created if missing. */
export function getDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = resolveDataDir(env);
  mkdirSync(dir, { recursive: true });
  return dir;
}
