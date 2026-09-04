/**
 * skills data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/skills` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the skills-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { homedir } from "node:os";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const effectiveHome = resolveEffectiveHome;
export const DATA_DIR_ENV = "HASNA_SKILLS_DIR";
export const HASNA_SKILLS_HOME_ENV = "HASNA_SKILLS_HOME";
export const SKILLS_HOME_ENV = "SKILLS_HOME";
export const DEFAULT_SQLITE_FILENAME = "server.db";
export const GLOBAL_CONFIG_FILENAME = "config.json";

/**
 * The resolver skills data root: kind overrides honored,
 * `~/.hasna/skills` on macOS, `~/.local/share/hasna/skills` on Linux.
 */
export function resolverDataRoot(
  home: string = effectiveHome(),
  env?: Record<string, string | undefined>,
): string {
  return resolverDataDir({ app: "skills", home, env });
}

/**
 * The pre-ruling legacy root (`~/.hasna/skills`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function legacyDataRoot(): string {
  return join(effectiveHome(), ".hasna", "skills");
}

export function exactDataRoot(): string | undefined {
  for (const key of [DATA_DIR_ENV, HASNA_SKILLS_HOME_ENV, SKILLS_HOME_ENV] as const) {
    const dir = process.env[key]?.trim();
    if (dir) return resolve(dir);
  }
  return undefined;
}

/**
 * The effective skills data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function getDataRoot(): string {
  const exact = exactDataRoot();
  if (exact) return exact;
  return resolve(resolverDataRoot());
}

export function hasExactOverride(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    Boolean(env[DATA_DIR_ENV]?.trim()) ||
    Boolean(env[HASNA_SKILLS_HOME_ENV]?.trim()) ||
    Boolean(env[SKILLS_HOME_ENV]?.trim())
  );
}
export function hasOperatorOverride(env: NodeJS.ProcessEnv = process.env): boolean {
  return hasExactOverride(env) || Boolean(env.HASNA_DATA_HOME?.trim());
}
export function skillsDataRootForHome(home: string): string {
  const isOwnHome =
    resolve(home) === resolve(effectiveHome()) || resolve(home) === resolve(homedir());
  if (isOwnHome) {
    const exact = exactDataRoot();
    if (exact) return exact;
    return resolve(resolverDataRoot(home));
  }
  // A staged home mirror (e.g. an rsync'd remote-station `homesRoot`):
  // process-level overrides describe THIS machine's live store and must not
  // leak into the mirror's resolution, so resolve with a scrubbed env.
  return resolve(resolverDataRoot(home, {}));
}