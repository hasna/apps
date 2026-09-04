/**
 * orgs data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`the orgs data root` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the orgs-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const getHomeDir = resolveEffectiveHome;

/**
 * The resolver orgs data root: kind overrides honored,
 * `the orgs data root` on macOS, `~/.local/share/hasna/orgs` on Linux.
 */
export function getResolverDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolverDataDir({ app: "orgs", home: getHomeDir(env), env, });
}

/**
 * The pre-ruling legacy root (`the orgs data root`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function getLegacyDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", "orgs");
}

export function getExactDataRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env.HASNA_ORGS_HOME;
  if (dir && dir.trim()) return resolve(dir.trim());
  return undefined;
}

/**
 * The effective orgs data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function getDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const exact = getExactDataRoot(env);
  if (exact) return exact;
  return resolve(getResolverDataRoot(env));
}
