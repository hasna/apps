/**
 * instructions data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/instructions` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the instructions-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const homeDir = resolveEffectiveHome;
export const HASNA_CONFIGS_HOME_ENV = "HASNA_CONFIGS_HOME";

/**
 * The resolver instructions data root: kind overrides honored,
 * `~/.hasna/instructions` on macOS, `~/.local/share/hasna/instructions` on Linux.
 */
export function resolverStoreHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolverDataDir({ app: "instructions", home: homeDir(env), env, });
}

/**
 * The pre-ruling legacy root (`~/.hasna/instructions`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function legacyStoreHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeDir(env), ".hasna", "instructions");
}

export function exactStoreHome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = env[HASNA_CONFIGS_HOME_ENV];
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * The effective instructions data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function getConfigsStoreHome(env: NodeJS.ProcessEnv = process.env): string {
  const exact = exactStoreHome(env);
  if (exact) return exact;
  return resolve(resolverStoreHome(env));
}

export function getConfigsStoreDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getConfigsStoreHome(env), "instructions.db");
}
export function getReportedDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["HASNA_INSTRUCTIONS_DB_PATH"];
  if (typeof override === "string" && override.length > 0) return override;
  return getConfigsStoreDbPath(env);
}