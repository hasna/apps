import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Subdirectories provisioned under ~/.hasna/workforce (mode 0700). */
export const WORKFORCE_APP_SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"] as const;
export type WorkforceAppSubdir = typeof WORKFORCE_APP_SUBDIRS[number];

function homeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

export function getWorkforceAppHome(): string {
  return resolve(
    process.env["HASNA_WORKFORCE_HOME"]
      ?? process.env["WORKFORCE_HOME"]
      ?? join(homeDir(), ".hasna", "workforce"),
  );
}

export function getWorkforceAppDir(name: WorkforceAppSubdir): string {
  return join(getWorkforceAppHome(), name);
}

/** Create ~/.hasna/workforce and all subdirs with directory mode 0700. */
export function ensureWorkforceAppHome(): Record<WorkforceAppSubdir | "root", string> {
  const root = getWorkforceAppHome();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dirs = { root } as Record<WorkforceAppSubdir | "root", string>;
  for (const name of WORKFORCE_APP_SUBDIRS) {
    const dir = getWorkforceAppDir(name);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    dirs[name] = dir;
  }
  return dirs;
}

export function getDefaultWorkforceDbPath(): string {
  return join(getWorkforceAppDir("data"), "workforce.db");
}

export function getDefaultWorkforceBackupDir(): string {
  return getWorkforceAppDir("backups");
}

export function getDefaultWorkforceExportDir(): string {
  return getWorkforceAppDir("exports");
}
