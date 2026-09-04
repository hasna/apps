/**
 * monitor data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`the monitor data root` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the monitor-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const effectiveHome = resolveEffectiveHome;
export const HASNA_MONITOR_HOME_ENV = "HASNA_MONITOR_HOME";

/**
 * The resolver monitor data root: kind overrides honored,
 * `the monitor data root` on macOS, `~/.local/share/hasna/monitor` on Linux.
 */
export function resolverHome(): string {
  return resolverDataDir({ app: "monitor", home: effectiveHome(),  });
}

/**
 * The pre-ruling legacy root (`the monitor data root`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "monitor");
}

export function exactMonitorDir(): string | undefined {
  const dir = process.env["MONITOR_CONFIG_DIR"];
  if (dir && dir.trim()) return dir.trim();
  const home = process.env[HASNA_MONITOR_HOME_ENV];
  if (home && home.trim()) return home.trim();
  return undefined;
}

/**
 * The effective monitor data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function getMonitorDir(): string {
  const exact = exactMonitorDir();
  if (exact) return exact;
  return resolve(resolverHome());
}

export function hasExactMonitorOverride(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env["MONITOR_CONFIG_DIR"]?.trim()) || Boolean(env[HASNA_MONITOR_HOME_ENV]?.trim());
}