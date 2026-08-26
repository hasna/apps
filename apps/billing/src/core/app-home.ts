import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/**
 * Billing app-home resolution via the @hasna/paths resolver (XDG / macOS home
 * layout). All subdirs are created mode 0700 so money/audit artifacts are never
 * world-readable (BUILD-SPEC §4.4).
 */
export const BILLING_APP_SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"] as const;
export type BillingAppSubdir = (typeof BILLING_APP_SUBDIRS)[number];

function homeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

/** Env var names for the exact-app home overrides. */
export const HASNA_BILLING_HOME_ENV = "HASNA_BILLING_HOME";
export const BILLING_HOME_ENV = "BILLING_HOME";

/** Pre-XDG default home: ~/.hasna/billing (computed at call time; HOME may be redirected). */
export function legacyHomeDir(): string {
  return resolve(join(homeDir(), ".hasna", "billing"));
}

/**
 * The @hasna/paths-resolved data home for billing (XDG layout):
 * ~/.local/share/hasna/billing on Linux; ~/Library/Application
 * Support/Hasna/billing on macOS.
 */
export function resolverHome(): string {
  return dataDir({ app: "billing" });
}

/**
 * Whether the resolver (XDG) home should be adopted as the store home. The
 * resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the store
 * has already been physically migrated there (`data/billing.db` exists). A
 * machine that only redirects another kind must NOT have its data home moved,
 * and a live store at the legacy home must never become invisible on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "data", "billing.db"));
}

/** The exact-app override root: `HASNA_BILLING_HOME` wins over `BILLING_HOME`. Empty values are treated as unset. */
function exactBillingHome(): string | undefined {
  const canonical = process.env[HASNA_BILLING_HOME_ENV];
  if (canonical && canonical.trim()) return canonical.trim();
  const alias = process.env[BILLING_HOME_ENV];
  if (alias && alias.trim()) return alias.trim();
  return undefined;
}

/**
 * Effective billing home: an exact-app override (`HASNA_BILLING_HOME`, then the
 * `BILLING_HOME` fallback) wins unconditionally; otherwise the @hasna/paths
 * data home once adopted (`HASNA_DATA_HOME` set or the store already migrated
 * there); otherwise the legacy `~/.hasna/billing` default, so an existing store
 * never becomes invisible on upgrade.
 */
export function getBillingAppHome(): string {
  const exact = exactBillingHome();
  if (exact) return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : legacyHomeDir();
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
