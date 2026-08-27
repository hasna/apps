import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/** Env var names for the exact-app home overrides. */
export const HASNA_ACCESS_HOME_ENV = "HASNA_ACCESS_HOME";
export const ACCESS_HOME_ENV = "ACCESS_HOME";

/**
 * Resolves the access home and its subdirs through the @hasna/paths resolver
 * (XDG / macOS home layout), enforcing 0700 permissions so that SQLite data,
 * exports, and pre-migration backups are never world-readable. Once the
 * resolver home is adopted, the store lives at the data home
 * (~/.local/share/hasna/access on Linux; ~/Library/Application
 * Support/Hasna/access on macOS). Until then the legacy `~/.hasna/access`
 * default stays the effective home, so an existing store and its layout never
 * become invisible on upgrade.
 */
export const APP_SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"] as const;
export type AppSubdir = typeof APP_SUBDIRS[number];

/** Pre-XDG default home: ~/.hasna/access. */
export const LEGACY_HOME_DIR = join(homedir(), ".hasna", "access");

/** The @hasna/paths-resolved data home for access (XDG layout). */
export function resolverHome(): string {
  return dataDir({ app: "access" });
}

/**
 * Whether the resolver (XDG) home should be adopted as the store home. The
 * resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the store
 * has already been physically migrated there (`access.db` exists). A machine
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
  return existsSync(join(resolved, "access.db"));
}

/** The exact-app override root, when set: `HASNA_ACCESS_HOME` wins over `ACCESS_HOME`. */
export function exactAccessHome(): string | undefined {
  const home = process.env[HASNA_ACCESS_HOME_ENV];
  if (home && home.trim()) return home.trim();
  const fallback = process.env[ACCESS_HOME_ENV];
  if (fallback && fallback.trim()) return fallback.trim();
  return undefined;
}

/**
 * Effective access home: an exact-app override (`HASNA_ACCESS_HOME`, then the
 * `ACCESS_HOME` fallback) wins unconditionally; otherwise the resolver data
 * home once adopted; otherwise the legacy `~/.hasna/access` default.
 */
export function getAppHome(): string {
  const exact = exactAccessHome();
  if (exact) return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(LEGACY_HOME_DIR);
}

/** A subdirectory of the effective access home. */
export function getAppDir(name: AppSubdir): string {
  return join(getAppHome(), name);
}

function ensureDir0700(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // best-effort on platforms without POSIX perms
  }
}

/** Ensure the effective access home and its subdirs exist with mode 0700. */
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

/** The live SQLite path — at the root of the effective access home. */
export function getDefaultDbPath(): string {
  return join(getAppHome(), "access.db");
}

/** Backups live in the `backups` subdir of the effective access home. */
export function getBackupDir(): string {
  return getAppDir("backups");
}
