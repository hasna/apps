/**
 * repos data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/repos` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the repos-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const getHomeDir = resolveEffectiveHome;

/**
 * The resolver repos data root: kind overrides honored,
 * `~/.hasna/repos` on macOS, `~/.local/share/hasna/repos` on Linux.
 */
export function getResolverDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolverDataDir({ app: "repos", home: getHomeDir(env), env, });
}

/**
 * The pre-ruling legacy root (`~/.hasna/repos`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function getLegacyDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", "repos");
}

export function getExactDataRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env["HASNA_REPOS_HOME"];
  if (dir && dir.trim()) return resolve(dir.trim());
  return undefined;
}

/**
 * The effective data root for an explicitly supplied home directory, used by
 * callers that keep a `homeDir` parameter for backward compatibility.
 * `HASNA_REPOS_HOME` wins unconditionally, then the resolver data root under
 * the given home (ruling #1668).
 */
export function getDataRootForHome(homeDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const exact = getExactDataRoot(env);
  if (exact) return exact;
  return resolve(resolveDataDirForHome(homeDir, env));
}

/** Resolver data root for an explicitly supplied home directory. */
export function resolveDataDirForHome(homeDir: string, env: NodeJS.ProcessEnv = process.env): string {
  return resolverDataDir({ app: "repos", home: homeDir, env });
}

/**
 * The effective repos data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function getDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const exact = getExactDataRoot(env);
  if (exact) return exact;
  return resolve(getResolverDataRoot(env));
}
