/**
 * telephony data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/telephony` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the telephony-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const getHomeDir = resolveEffectiveHome;

/**
 * The resolver telephony data root: kind overrides honored,
 * `~/.hasna/telephony` on macOS, `~/.local/share/hasna/telephony` on Linux.
 */
export function getResolverDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolverDataDir({ app: "telephony", home: getHomeDir(env), env, });
}

/**
 * The pre-ruling legacy root (`~/.hasna/telephony`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function getLegacyDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", "telephony");
}


/**
 * The effective telephony data root (ruling #1668 — the resolver root IS
 * the convention on every platform); file-level store overrides are layered
 * on top by the individual store layers and always win regardless.
 */
export function getDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(getResolverDataRoot(env));
}
