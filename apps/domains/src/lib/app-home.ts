/**
 * domains data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`the domains data root` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the domains-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const effectiveHome = resolveEffectiveHome;
export const APP = "domains" as const;

/**
 * The resolver domains data root: kind overrides honored,
 * `the domains data root` on macOS, `~/.local/share/hasna/domains` on Linux.
 */
export function resolverHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolverDataDir({ app: "domains", home: effectiveHome(env), env, });
}

/**
 * The pre-ruling legacy root (`the domains data root`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function legacyHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(effectiveHome(env), ".hasna", "domains");
}

export function exactAppOverride(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override =
    env["HASNA_DOMAINS_HOME"] ??
    env["DOMAINS_HOME"] ??
    env["HASNA_DOMAINS_DIR"] ??
    env["DOMAINS_DIR"];
  return override && override.trim() ? override.trim() : undefined;
}

/**
 * The effective domains data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function appHome(env: NodeJS.ProcessEnv = process.env): string {
  const exact = exactAppOverride(env);
  if (exact) return exact;
  return resolve(resolverHome(env));
}

export function getDefaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(appHome(env), `${APP}.db`);
}
export function getDefaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(appHome(env), "config.json");
}