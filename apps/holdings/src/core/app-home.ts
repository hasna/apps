import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { APP_NAME } from "../config.js";

export const HOLDINGS_APP_SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"] as const;
export type HoldingsAppSubdir = (typeof HOLDINGS_APP_SUBDIRS)[number];

const DIR_MODE = 0o700;

function homeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

/** Root app-home directory: ~/.hasna/holdings (mode 0700). */
export function getHoldingsAppHome(): string {
  return resolve(process.env["HASNA_HOLDINGS_HOME"] ?? process.env["HOLDINGS_HOME"] ?? join(homeDir(), ".hasna", APP_NAME));
}

export function getHoldingsAppDir(name: HoldingsAppSubdir): string {
  return join(getHoldingsAppHome(), name);
}

/** Ensure ~/.hasna/holdings and all subdirs exist with mode 0700. */
export function ensureHoldingsAppHome(): Record<HoldingsAppSubdir | "root", string> {
  const root = getHoldingsAppHome();
  mkdirSync(root, { recursive: true, mode: DIR_MODE });
  const dirs = { root } as Record<HoldingsAppSubdir | "root", string>;
  for (const name of HOLDINGS_APP_SUBDIRS) {
    const dir = getHoldingsAppDir(name);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    dirs[name] = dir;
  }
  return dirs;
}

export function getHoldingsBackupDir(): string {
  return getHoldingsAppDir("backups");
}
