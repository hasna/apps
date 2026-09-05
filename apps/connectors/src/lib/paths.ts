/**
 * connectors data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/connectors` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the connectors-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const effectiveHome = resolveEffectiveHome;

/**
 * The resolver connectors data root: kind overrides honored,
 * `~/.hasna/connectors` on macOS, `~/.local/share/hasna/connectors` on Linux.
 */
export function resolverHome(): string {
  return resolverDataDir({ app: "connectors", home: effectiveHome(),  });
}

/**
 * The pre-ruling legacy root (`~/.hasna/connectors`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "connectors");
}

export function exactConnectorsHome(): string | undefined {
  const home = envOr("HASNA_CONNECTORS_DIR", "");
  return home ? home : undefined;
}
function envOr(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

/**
 * The effective connectors data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function connectorsHome(): string {
  const exact = exactConnectorsHome();
  if (exact) return exact;
  return resolve(resolverHome());
}
