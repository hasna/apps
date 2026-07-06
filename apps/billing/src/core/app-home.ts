import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * ~/.hasna/billing path resolution. All subdirs are created mode 0700 so
 * money/audit artifacts are never world-readable (BUILD-SPEC §4.4).
 */
export const BILLING_APP_SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"] as const;
export type BillingAppSubdir = (typeof BILLING_APP_SUBDIRS)[number];

function homeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

export function getBillingAppHome(): string {
  return resolve(
    process.env["HASNA_BILLING_HOME"] ?? process.env["BILLING_HOME"] ?? join(homeDir(), ".hasna", "billing"),
  );
}

export function getBillingAppDir(name: BillingAppSubdir): string {
  return join(getBillingAppHome(), name);
}

/** Create the app-home tree with 0700 perms and return the resolved dirs. */
export function ensureBillingAppHome(): Record<BillingAppSubdir | "root", string> {
  const root = getBillingAppHome();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dirs = { root } as Record<BillingAppSubdir | "root", string>;
  for (const name of BILLING_APP_SUBDIRS) {
    const dir = getBillingAppDir(name);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    dirs[name] = dir;
  }
  return dirs;
}

export function getDefaultBillingDbPath(): string {
  return join(getBillingAppDir("data"), "billing.db");
}

export function getDefaultBillingBackupDir(): string {
  return getBillingAppDir("backups");
}
