/**
 * loops data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/loops` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the loops-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const effectiveHome = resolveEffectiveHome;
export const HASNA_LOOPS_DATA_DIR_ENV = "HASNA_LOOPS_DATA_DIR";

/**
 * The resolver loops data root: kind overrides honored,
 * `~/.hasna/loops` on macOS, `~/.local/share/hasna/loops` on Linux.
 */
export function resolverHome(): string {
  return resolverDataDir({ app: "loops", home: effectiveHome(),  });
}

/**
 * The pre-ruling legacy root (`~/.hasna/loops`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "loops");
}

export function exactLoopsDataDir(): string | undefined {
  const dir = process.env["LOOPS_DATA_DIR"];
  if (dir && dir.trim()) return dir.trim();
  const home = process.env[HASNA_LOOPS_DATA_DIR_ENV];
  if (home && home.trim()) return home.trim();
  return undefined;
}

/**
 * The effective loops data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function getLoopsDataDir(): string {
  const exact = exactLoopsDataDir();
  if (exact) return exact;
  return resolve(resolverHome());
}
