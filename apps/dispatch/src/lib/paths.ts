/**
 * dispatch data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/dispatch` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the dispatch-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const getHomeDir = resolveEffectiveHome;
export const DISPATCH_DATA_DIR_ENV = "DISPATCH_DATA_DIR";

/**
 * The resolver dispatch data root: kind overrides honored,
 * `~/.hasna/dispatch` on macOS, `~/.local/share/hasna/dispatch` on Linux.
 */
export function getResolverDataDir(): string {
  return resolverDataDir({ app: "dispatch", home: getHomeDir(),  });
}

/**
 * The pre-ruling legacy root (`~/.hasna/dispatch`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function getLegacyDataDir(): string {
  return join(getHomeDir(), ".hasna", "dispatch");
}

export function getExactDataDir(): string | undefined {
  const dir = process.env[DISPATCH_DATA_DIR_ENV];
  if (dir && dir.trim()) return dir.trim();
  return undefined;
}
export function dbPath(): string {
  return join(dataDir(), "dispatch.db");
}
export function pidFilePath(): string {
  return join(dataDir(), "daemon.pid");
}
export function daemonLogPath(): string {
  return join(dataDir(), "daemon.log");
}
export function daemonStatePath(): string {
  return join(dataDir(), "daemon.state.json");
}
export function daemonPidLockPath(): string {
  return join(dataDir(), "daemon.pid.lock");
}
export function artifactsDir(): string {
  return join(dataDir(), "artifacts");
}

/** Root data directory for @hasna/dispatch state. */
export function dataDir(): string {
  return getDataDir();
}

/**
 * The effective dispatch data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function getDataDir(): string {
  const exact = getExactDataDir();
  if (exact) return exact;
  return resolve(getResolverDataDir());
}
