import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cacheDir, configDir, dataDir, stateDir } from "@hasna/paths";

/**
 * Resolves the access home directories via the @hasna/paths resolver (XDG /
 * macOS home layout), enforcing 0700 permissions so that SQLite data, exports,
 * and pre-migration backups are never world-readable.
 *
 * Subdir mapping onto the XDG kinds:
 *   config   -> config home          (~/.config/hasna/access)
 *   data     -> data home            (~/.local/share/hasna/access) — holds access.db
 *   exports  -> data home/exports
 *   backups  -> data home/backups
 *   logs     -> state home/logs      (~/.local/state/hasna/access/logs)
 *   tmp      -> cache home/tmp       (~/.cache/hasna/access/tmp)
 */
export const APP_SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"] as const;
export type AppSubdir = typeof APP_SUBDIRS[number];

const OPTIONS = { app: "access" } as const;

/** The data home for the access app (canonical SQLite, exports, and backups root). */
export function getAppHome(): string {
  return dataDir(OPTIONS);
}

export function getAppDir(name: AppSubdir): string {
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

export function getDefaultDbPath(): string {
  return join(getAppDir("data"), "access.db");
}

export function getBackupDir(): string {
  return getAppDir("backups");
}
