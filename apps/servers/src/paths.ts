/**
 * @hasna/servers data-root resolution — the legacy `~/.hasna/servers` default,
 * resolved through the @hasna/paths resolver (XDG / macOS home layout).
 *
 * The legacy `~/.hasna/servers` default stays the effective data root until the
 * XDG data home is adopted — the operator sets `HASNA_DATA_HOME` (the
 * data-kind override — a deliberate opt-in to the XDG layout), or the store
 * has already been physically migrated there (`servers.db` exists at the
 * resolver root) — so an existing local store never becomes invisible on
 * upgrade. The pre-existing `SERVERS_DB_PATH` store override and the
 * per-project `.servers/servers.db` discovery in `getDbPath()` keep their
 * precedence above this default.
 *
 * Everything accepts an explicit env object (default `process.env`) so the
 * resolver is deterministic in tests and honors the same `$HOME`-first home
 * resolution the package has always used.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

export const APP = "servers" as const;

/** The effective user home, mirroring the pre-existing servers resolution (`HOME` || `USERPROFILE` || os.homedir()). */
export function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env["HOME"] || env["USERPROFILE"] || homedir();
}

/** Pre-XDG default data root: ~/.hasna/servers. */
export function getLegacyDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", APP);
}

/**
 * The @hasna/paths-resolved data root for servers (XDG / macOS home layout):
 * `~/.local/share/hasna/servers` on Linux, `~/Library/Application
 * Support/Hasna/servers` on macOS. The home override mirrors the pre-existing
 * `$HOME`-first resolution, and the env object is passed through so
 * `HASNA_DATA_HOME` in the caller's env is honored.
 */
export function getResolverDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const home = env["HOME"] || env["USERPROFILE"];
  return dataDir({ app: APP, home, env });
}

/**
 * Whether the resolver (XDG) data root should be adopted as the servers data
 * root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (a deliberate opt-in to the XDG layout) or the store has
 * already been physically migrated there (`servers.db` exists). A machine that
 * only redirects another kind (e.g. cache to tmpfs) must NOT have its data
 * home moved, and a live store at the legacy home must never become invisible
 * on upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "servers.db"));
}

/**
 * The effective data root: the resolver (XDG) data root once adopted
 * (`HASNA_DATA_HOME` set, or the store already migrated there); otherwise the
 * legacy `~/.hasna/servers` default — an existing store never becomes
 * invisible on upgrade. The pre-existing `SERVERS_DB_PATH` store override and
 * the per-project `.servers/servers.db` discovery sit above this default in
 * `getDbPath()`.
 */
export function getDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const resolved = getResolverDataRoot(env);
  return adoptResolverDataRoot(resolved, env)
    ? resolve(resolved)
    : resolve(getLegacyDataRoot(env));
}

/** The default SQLite db path, at the root of the effective data root. */
export function defaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getDataRoot(env), "servers.db");
}
