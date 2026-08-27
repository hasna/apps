import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";
import { APP_NAME } from "../config.js";

export const HOLDINGS_APP_SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"] as const;
export type HoldingsAppSubdir = (typeof HOLDINGS_APP_SUBDIRS)[number];

const DIR_MODE = 0o700;

function homeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data home for holdings.
 * This is the forward-looking home the XDG home migration (hotfixes plan
 * 0f49f56a, task P3.3) moves the store toward: `~/.local/share/hasna/holdings`
 * on Linux, `~/Library/Application Support/Hasna/holdings` on macOS. The home
 * override mirrors the pre-existing `$HOME`-first resolution so the resolver
 * follows the same home the legacy path does.
 */
export function getResolverAppHome(): string {
  return dataDir({ app: APP_NAME, home: homeDir() });
}

/** The legacy (pre-XDG) app home: ~/.hasna/holdings */
export function getLegacyAppHome(): string {
  return join(homeDir(), ".hasna", APP_NAME);
}

/**
 * Whether the resolver (XDG) app home should be adopted as the effective app
 * home. The resolver home is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`holdings.db` exists). A machine that only redirects another kind (e.g.
 * cache to tmpfs) must NOT have its data home moved, and a live store at the
 * legacy home must never become invisible on upgrade.
 */
export function adoptResolverAppHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "holdings.db"));
}

/** The exact-app override root, when set: `HASNA_HOLDINGS_HOME`, then `HOLDINGS_HOME`. */
export function getExactAppHome(): string | undefined {
  const dir = process.env["HASNA_HOLDINGS_HOME"] ?? process.env["HOLDINGS_HOME"];
  if (dir && dir.trim()) return dir.trim();
  return undefined;
}

/**
 * Effective app-home root: the exact-app override (`HASNA_HOLDINGS_HOME`, then
 * `HOLDINGS_HOME`) wins unconditionally; otherwise the resolver (XDG) data
 * home once adopted; otherwise the legacy `~/.hasna/holdings` default. The
 * SQLite store and the backups subdir live under this root.
 */
export function getHoldingsAppHome(): string {
  const exact = getExactAppHome();
  if (exact) return resolve(exact);
  const resolved = getResolverAppHome();
  return adoptResolverAppHome(resolved) ? resolve(resolved) : resolve(getLegacyAppHome());
}

export function getHoldingsAppDir(name: HoldingsAppSubdir): string {
  return join(getHoldingsAppHome(), name);
}

/** Ensure the effective app home and all subdirs exist with mode 0700. */
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
