import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const FLEET_APP_SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"] as const;
export type FleetAppSubdir = (typeof FLEET_APP_SUBDIRS)[number];

function homeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

/** Root of the app-home: ~/.hasna/fleet (override with HASNA_FLEET_HOME / FLEET_HOME). */
export function getFleetAppHome(): string {
  return resolve(
    process.env["HASNA_FLEET_HOME"] ?? process.env["FLEET_HOME"] ?? join(homeDir(), ".hasna", "fleet"),
  );
}

export function getFleetAppDir(name: FleetAppSubdir): string {
  return join(getFleetAppHome(), name);
}

/** Ensure ~/.hasna/fleet and all subdirs exist with mode 0700 (owner-only). */
export function ensureFleetAppHome(): Record<FleetAppSubdir | "root", string> {
  const root = getFleetAppHome();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dirs = { root } as Record<FleetAppSubdir | "root", string>;
  for (const name of FLEET_APP_SUBDIRS) {
    const dir = getFleetAppDir(name);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    dirs[name] = dir;
  }
  return dirs;
}

export function getDefaultFleetDbPath(): string {
  return join(getFleetAppDir("data"), "fleet.db");
}

export function getDefaultFleetBackupDir(): string {
  return getFleetAppDir("backups");
}
