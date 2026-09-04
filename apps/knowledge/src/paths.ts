/**
 * knowledge data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/knowledge` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the knowledge-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const getHomeDir = resolveEffectiveHome;
export const KNOWLEDGE_DATA_HOME_ENV = 'HASNA_KNOWLEDGE_HOME';

/**
 * The resolver knowledge data root: kind overrides honored,
 * `~/.hasna/knowledge` on macOS, `~/.local/share/hasna/knowledge` on Linux.
 */
export function getResolverDataHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolverDataDir({ app: "knowledge", home: getHomeDir(env), env, });
}

/**
 * The pre-ruling legacy root (`~/.hasna/knowledge`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function getLegacyDataHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", "knowledge");
}

export function getExactDataHome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env[KNOWLEDGE_DATA_HOME_ENV]?.trim();
  if (dir) return resolve(dir);
  return undefined;
}

/**
 * The effective knowledge data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function getDataHome(env: NodeJS.ProcessEnv = process.env): string {
  const exact = getExactDataHome(env);
  if (exact) return exact;
  return resolve(getResolverDataHome(env));
}
