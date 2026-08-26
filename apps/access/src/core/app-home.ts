import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { cacheDir, configDir, dataDir, stateDir } from "@hasna/paths";

/**
 * Resolves the access home directories via the @hasna/paths resolver (XDG /
 * macOS home layout), enforcing 0700 permissions so that SQLite data, exports,
 * and pre-migration backups are never world-readable.
 *
 * Subdir mapping once the XDG home is adopted:
 *   config   -> config home          (~/.config/hasna/access)
 *   data     -> data home            (~/.local/share/hasna/access) — holds access.db
 *   exports  -> data home/exports
 *   backups  -> data home/backups
 *   logs     -> state home/logs      (~/.local/state/hasna/access/logs)
 *   tmp      -> cache home/tmp       (~/.cache/hasna/access/tmp)
 *
 * Until the XDG home is adopted (or an exact-app override is set), the legacy
 * `~/.hasna/access` default stays the effective home and subdirs stay under it,
 * so an existing store and layout never become invisible on upgrade.
 */
export const APP_SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"] as const;
export type AppSubdir = typeof APP_SUBDIRS[number];

const OPTIONS = { app: "access" } as const;

/** Pre-XDG default home: ~/.hasna/access. */
export const LEGACY_HOME_DIR = join(homedir(), ".hasna", "access");

/** The @hasna/paths-resolved data home for access (XDG layout). */
export function resolverHome(): string {
  return dataDir(OPTIONS);
}

/**
 * Whether the resolver (XDG) home should be adopted as the store home. The
 * resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the
 * store has already been physically migrated there (`access.db` exists). A
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
  return existsSync(join(resolved, "access.db"));
}

/** The exact-app override root (HASNA_ACCESS_HOME ?? ACCESS_HOME), when set. */
function exactAppOverride(): string | undefined {
  const override = process.env["HASNA_ACCESS_HOME"] ?? process.env["ACCESS_HOME"];
  return override && override.trim() ? override.trim() : undefined;
}

/**
 * Effective home: the exact-app override (`HASNA_ACCESS_HOME` / `ACCESS_HOME`)
 * wins unconditionally; otherwise the resolver home once adopted; otherwise
 * the legacy `~/.hasna/access` default.
 */
export function getAppHome(): string {
  const override = exactAppOverride();
  if (override) return resolve(override);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(LEGACY_HOME_DIR);
}

export function getAppDir(name: AppSubdir): string {
  // An exact-app override, or the pre-adoption default, keeps the legacy
  // subdir layout under the effective home.
  if (exactAppOverride() || !adoptResolverHome(resolverHome())) {
    return join(getAppHome(), name);
  }
  switch (name) {
    case "config":
      return configDir(OPTIONS);
    case "data":
      return dataDir(OPTIONS);
    case "exports":
      return join(dataDir(OPTIONS), "exports");
    case "backups":
      return join(dataDir(OPTIONS), "backups");
    case "logs":
      return join(stateDir(OPTIONS), "logs");
    case "tmp":
      return join(cacheDir(OPTIONS), "tmp");
  }
}

function ensureDir0700(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // best-effort on platforms without POSIX perms
  }
}

export function ensureAppHome(): Record<AppSubdir | "root", string> {
  const root = getAppHome();
  ensureDir0700(root);
  const dirs = { root } as Record<AppSubdir | "root", string>;
  for (const name of APP_SUBDIRS) {
    const dir = getAppDir(name);
    ensureDir0700(dir);
    dirs[name] = dir;
  }
  return dirs;
}

/** The live store path — at the root of the effective home, matching the pre-migration layout. */
export function getDefaultDbPath(): string {
  return join(getAppHome(), "access.db");
}

export function getBackupDir(): string {
  return getAppDir("backups");
}
