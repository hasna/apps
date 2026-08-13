import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Resolves ~/.hasna/access and its subdirs, enforcing 0700 permissions so that
 * SQLite data, exports, and pre-migration backups are never world-readable.
 */
export const APP_SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"] as const;
export type AppSubdir = typeof APP_SUBDIRS[number];

function homeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

export function getAppHome(): string {
  return resolve(
    process.env["HASNA_ACCESS_HOME"] ?? process.env["ACCESS_HOME"] ?? join(homeDir(), ".hasna", "access"),
  );
}

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
