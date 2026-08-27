import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { dataDir as resolverDataDir } from "@hasna/paths";

/** Env var name for the exact-app data-home override. */
export const DISPATCH_DATA_DIR_ENV = "DISPATCH_DATA_DIR";

/**
 * The effective user home, mirroring the pre-existing dispatch resolution
 * (`HOME` || `USERPROFILE` || `os.homedir()`). Read at call time because the
 * config/CLI tests switch `$HOME` mid-process and bun's `os.homedir()` does
 * not follow that switch. A home that cannot be resolved is a hard error —
 * never a literal "~" path (relative to cwd) and never an
 * "undefined"-prefixed path.
 */
export function getHomeDir(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  if (!home) throw new Error("Could not resolve the user home directory");
  return home;
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data dir for dispatch.
 * This is the forward-looking home the XDG migration (hotfixes plan 0f49f56a,
 * task P3.3) moves the store toward: `~/.local/share/hasna/dispatch` on Linux,
 * `~/Library/Application Support/Hasna/dispatch` on macOS. The home override
 * mirrors the pre-existing $HOME-first resolution so the resolver follows the
 * same home the legacy path does.
 */
export function getResolverDataDir(): string {
  return resolverDataDir({ app: "dispatch", home: getHomeDir() });
}

/** The legacy (pre-XDG) data dir: ~/.hasna/dispatch */
export function getLegacyDataDir(): string {
  return join(getHomeDir(), ".hasna", "dispatch");
}

/**
 * Whether the resolver (XDG) data dir should be adopted as the effective data
 * dir. The resolver dir is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`dispatch.db` exists). A machine that only redirects another kind (e.g.
 * cache to tmpfs) must NOT have its data home moved, and a live store at the
 * legacy home must never become invisible on upgrade.
 */
export function adoptResolverDataDir(
  resolved: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "dispatch.db"));
}

/** The exact-app override root, when set: `DISPATCH_DATA_DIR`. */
export function getExactDataDir(): string | undefined {
  const dir = process.env[DISPATCH_DATA_DIR_ENV];
  if (dir && dir.trim()) return dir.trim();
  return undefined;
}

/**
 * The effective dispatch data dir: an exact-app override (`DISPATCH_DATA_DIR`)
 * wins unconditionally; otherwise the resolver (XDG) data dir once adopted
 * (`HASNA_DATA_HOME` set, or `dispatch.db` already migrated there); otherwise
 * the legacy `~/.hasna/dispatch` default — an existing store never becomes
 * invisible on upgrade.
 */
export function getDataDir(): string {
  const exact = getExactDataDir();
  if (exact) return resolve(exact);
  const resolved = getResolverDataDir();
  return adoptResolverDataDir(resolved) ? resolve(resolved) : resolve(getLegacyDataDir());
}

/** Root data directory for @hasna/dispatch state. */
export function dataDir(): string {
  return getDataDir();
}

/** Path to the sqlite database file. */
export function dbPath(): string {
  return join(dataDir(), "dispatch.db");
}

/** Path to the daemon pid file. */
export function pidFilePath(): string {
  return join(dataDir(), "daemon.pid");
}

/** Path to the daemon log file. */
export function daemonLogPath(): string {
  return join(dataDir(), "daemon.log");
}

/** Path to the daemon heartbeat/state file. */
export function daemonStatePath(): string {
  return join(dataDir(), "daemon.state.json");
}

/** Directory used as an atomic daemon pidfile lock. */
export function daemonPidLockPath(): string {
  return join(dataDir(), "daemon.pid.lock");
}

/** Directory for bounded, redacted artifacts written by agent abstractions. */
export function artifactsDir(): string {
  return join(dataDir(), "artifacts");
}
