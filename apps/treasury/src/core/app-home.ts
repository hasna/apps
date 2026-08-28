/**
 * @hasna/treasury home resolution — the app data home, resolved through the
 * @hasna/paths resolver (XDG / macOS home layout).
 *
 * The legacy `~/.hasna/treasury` default stays the effective home until the
 * XDG data home is adopted — the operator sets `HASNA_DATA_HOME` (the
 * data-kind override — a deliberate opt-in to the XDG layout), or the store
 * has already been physically migrated there (`treasury.db` exists at the
 * resolver home) — so an existing local store, config and subdir layout never
 * become invisible on upgrade. An exact-app override (`HASNA_TREASURY_HOME` /
 * `TREASURY_HOME`) wins unconditionally and keeps the legacy layout under the
 * override root.
 *
 * Everything accepts an explicit env object (default `process.env`) so the
 * resolver is deterministic in tests and honors the same `$HOME`-first home
 * resolution the package has always used.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

export const TREASURY_APP_SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"] as const;
export type TreasuryAppSubdir = (typeof TREASURY_APP_SUBDIRS)[number];

/** App slug — the @hasna/paths app segment and the legacy ~/.hasna/<app> name. */
export const APP = "treasury" as const;

/** The effective user home, mirroring the pre-existing treasury resolution (`HOME` || `USERPROFILE` || os.homedir()). */
function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env["HOME"] || env["USERPROFILE"] || homedir();
}

/** Pre-XDG default home: ~/.hasna/treasury. */
export function legacyTreasuryHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeDir(env), ".hasna", APP);
}

/**
 * The @hasna/paths-resolved data home for treasury (XDG / macOS home layout).
 * The home override mirrors the pre-existing `$HOME`-first resolution, and the
 * env object is passed through so `HASNA_DATA_HOME` in the caller's env (not
 * only process.env) is honored.
 */
export function resolverTreasuryHome(env: NodeJS.ProcessEnv = process.env): string {
  const home = env["HOME"] || env["USERPROFILE"];
  return dataDir({ app: APP, home, env });
}

/**
 * Whether the resolver (XDG) home should be adopted as the app home. The
 * resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (a deliberate opt-in to the XDG layout) or the store has already been
 * physically migrated there (`treasury.db` exists). A machine that only
 * redirects another kind (e.g. cache to tmpfs) must NOT have its data home
 * moved, and a live store at the legacy home must never become invisible on
 * upgrade.
 */
export function adoptResolverTreasuryHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, `${APP}.db`));
}

/** The exact-app override root, when set: `HASNA_TREASURY_HOME` / `TREASURY_HOME`. Wins unconditionally. */
export function exactTreasuryHome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env["HASNA_TREASURY_HOME"] ?? env["TREASURY_HOME"];
  return override && override.trim() ? override.trim() : undefined;
}

/** Root: legacy ~/.hasna/treasury until the XDG data home is adopted (dirs are created mode 0700). */
export function getTreasuryAppHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = exactTreasuryHome(env);
  if (override) return resolve(override);
  const resolved = resolverTreasuryHome(env);
  return adoptResolverTreasuryHome(resolved, env) ? resolve(resolved) : resolve(legacyTreasuryHome(env));
}

export function getTreasuryAppDir(name: TreasuryAppSubdir, env: NodeJS.ProcessEnv = process.env): string {
  return join(getTreasuryAppHome(env), name);
}

/** Create the effective treasury home and all subdirs with mode 0700 (deny-by-default perms). */
export function ensureTreasuryAppHome(env: NodeJS.ProcessEnv = process.env): Record<TreasuryAppSubdir | "root", string> {
  const root = getTreasuryAppHome(env);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dirs = { root } as Record<TreasuryAppSubdir | "root", string>;
  for (const name of TREASURY_APP_SUBDIRS) {
    const dir = getTreasuryAppDir(name, env);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    dirs[name] = dir;
  }
  return dirs;
}

export function getDefaultTreasuryBackupDir(env: NodeJS.ProcessEnv = process.env): string {
  return getTreasuryAppDir("backups", env);
}
