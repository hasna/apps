/**
 * workflows data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/workflows` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the workflows-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const getHomeDir = resolveEffectiveHome;
export const APP = "workflows" as const;
export const STORE_DB_FILE = "workflows.db";

/**
 * The resolver workflows data root: kind overrides honored,
 * `~/.hasna/workflows` on macOS, `~/.local/share/hasna/workflows` on Linux.
 */
export function getResolverDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolverDataDir({ app: "workflows", home: getHomeDir(env), env, });
}

/**
 * The pre-ruling legacy root (`~/.hasna/workflows`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function getLegacyDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", "workflows");
}


/**
 * The effective workflows data root (ruling #1668 — the resolver root IS
 * the convention on every platform); file-level store overrides are layered
 * on top by the individual store layers and always win regardless.
 */
export function getEffectiveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(getResolverDataDir(env));
}
