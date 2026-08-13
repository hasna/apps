import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { APP_NAME } from "../config.js";

export const TREASURY_APP_SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"] as const;
export type TreasuryAppSubdir = (typeof TREASURY_APP_SUBDIRS)[number];

function homeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

/** Root: ~/.hasna/treasury (dirs are created mode 0700). */
export function getTreasuryAppHome(): string {
  return resolve(
    process.env["HASNA_TREASURY_HOME"] ?? process.env["TREASURY_HOME"] ?? join(homeDir(), ".hasna", APP_NAME),
  );
}

export function getTreasuryAppDir(name: TreasuryAppSubdir): string {
  return join(getTreasuryAppHome(), name);
}

/** Create ~/.hasna/treasury and all subdirs with mode 0700 (deny-by-default perms). */
export function ensureTreasuryAppHome(): Record<TreasuryAppSubdir | "root", string> {
  const root = getTreasuryAppHome();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dirs = { root } as Record<TreasuryAppSubdir | "root", string>;
  for (const name of TREASURY_APP_SUBDIRS) {
    const dir = getTreasuryAppDir(name);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    dirs[name] = dir;
  }
  return dirs;
}

export function getDefaultTreasuryBackupDir(): string {
  return getTreasuryAppDir("backups");
}
