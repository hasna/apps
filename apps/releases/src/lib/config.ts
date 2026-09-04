/**
 * releases data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/releases` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the releases-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const effectiveHome = resolveEffectiveHome;
export const HASNA_RELEASES_HOME_ENV = "HASNA_RELEASES_HOME";
export const RELEASES_HOME_ENV = "RELEASES_HOME";
export const RELEASES_DATA_DIR_ENV = "RELEASES_DATA_DIR";

/**
 * The resolver releases data root: kind overrides honored,
 * `~/.hasna/releases` on macOS, `~/.local/share/hasna/releases` on Linux.
 */
export function resolverHome(): string {
  return resolverDataDir({ app: "releases", home: effectiveHome(),  });
}

/**
 * The pre-ruling legacy root (`~/.hasna/releases`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "releases");
}

export function exactReleasesHome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of [HASNA_RELEASES_HOME_ENV, RELEASES_HOME_ENV, RELEASES_DATA_DIR_ENV]) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/**
 * The effective releases data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function resolveDataDir(dataDirOverride: string | undefined = undefined, ): string {
  const exact = exactReleasesHome();
  if (exact) return exact;
  return resolve(resolverHome());
}

export function ledgerDbPath(dataDir?: string): string {
  return join(resolveDataDir(dataDir), "releases.db");
}
export function outboxPath(dataDir?: string): string {
  return join(resolveDataDir(dataDir), "outbox.jsonl");
}
export function eventsDataDir(dataDir?: string): string {
  return join(resolveDataDir(dataDir), "events");
}