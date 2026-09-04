/**
 * hooks data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`the hooks data root` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the hooks-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const getHomeDir = resolveEffectiveHome;

/**
 * The resolver hooks data root: kind overrides honored,
 * `the hooks data root` on macOS, `~/.local/share/hasna/hooks` on Linux.
 */
export function getResolverDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolverDataDir({ app: "hooks", home: getHomeDir(env), env, });
}

/**
 * The pre-ruling legacy root (`the hooks data root`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function getLegacyDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", "hooks");
}

export function getExplicitDataDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env.HASNA_HOOKS_DATA_DIR ?? env.HOOKS_DATA_DIR;
  if (typeof dir === "string" && dir.trim().length > 0) return dir.trim();
  return undefined;
}
export function getExactDataRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env.HASNA_HOOKS_HOME?.trim() || env.HOOKS_HOME?.trim();
  if (dir) return resolve(dir);
  return undefined;
}
function getExplicitDbPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const db = env.HASNA_HOOKS_DB_PATH ?? env.HOOKS_DB_PATH;
  if (typeof db === "string" && db.trim().length > 0) return db.trim();
  return undefined;
}

/**
 * The effective hooks data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function getEffectiveDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const exact = getExplicitDataDir(env);
  if (exact) return exact;
  return resolve(getResolverDataRoot(env));
}

export function getReportedDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = getExplicitDbPath(env);
  if (explicit) return explicit;
  return join(getEffectiveDataRoot(env), "hooks.db");
}