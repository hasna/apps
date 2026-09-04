/**
 * bridge data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/bridge` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the bridge-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const effectiveHome = resolveEffectiveHome;
export const HASNA_BRIDGE_HOME_ENV = "HASNA_BRIDGE_HOME";

/**
 * The resolver bridge data root: kind overrides honored,
 * `~/.hasna/bridge` on macOS, `~/.local/share/hasna/bridge` on Linux.
 */
export function resolverHome(): string {
  return resolverDataDir({ app: "bridge", home: effectiveHome(),  });
}

/**
 * The pre-ruling legacy root (`~/.hasna/bridge`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "bridge");
}

export function exactBridgeHome(): string | undefined {
  const dir = process.env["BRIDGE_HOME"];
  if (dir && dir.trim()) return dir.trim();
  const home = process.env[HASNA_BRIDGE_HOME_ENV];
  if (home && home.trim()) return home.trim();
  return undefined;
}

/**
 * The effective bridge data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function getBridgeHome(): string {
  const exact = exactBridgeHome();
  if (exact) return exact;
  return resolve(resolverHome());
}

export function getConfigPath(): string {
  const override = process.env["BRIDGE_CONFIG"];
  if (override && override.trim()) return resolve(override.trim());
  return join(getBridgeHome(), "config.json");
}
export function getStatePath(): string {
  const override = process.env["BRIDGE_STATE"];
  if (override && override.trim()) return resolve(override.trim());
  return join(getBridgeHome(), "state.json");
}
export function getDaemonDir(): string {
  return join(getBridgeHome(), "daemon");
}