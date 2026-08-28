import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dataDir as pathsDataDir } from "@hasna/paths";

/** Env override names, in precedence order. */
export const HASNA_RELEASES_HOME_ENV = "HASNA_RELEASES_HOME";
export const RELEASES_HOME_ENV = "RELEASES_HOME";
export const RELEASES_DATA_DIR_ENV = "RELEASES_DATA_DIR";

/**
 * Pre-XDG default home: ~/.hasna/releases. Stays the effective data dir until
 * the resolver (XDG) home is adopted, so an existing store and its layout never
 * become invisible on upgrade.
 */
export const DEFAULT_DATA_DIR = join(homedir(), ".hasna", "releases");

/** The @hasna/paths-resolved data home for releases (XDG layout). */
export function resolverHome(): string {
  return pathsDataDir({ app: "releases" });
}

/**
 * Whether the resolver (XDG) home should be adopted as the data dir. The
 * resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the store
 * has already been physically migrated there (`releases.db` exists). A machine
 * that only redirects another kind (e.g. cache to tmpfs) must NOT have its data
 * home moved, and a live store at the legacy home must never become invisible
 * on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "releases.db"));
}

/**
 * The exact-app override root, when set: `HASNA_RELEASES_HOME` wins over
 * `RELEASES_HOME`, which wins over the long-documented `RELEASES_DATA_DIR`.
 */
export function exactReleasesHome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of [HASNA_RELEASES_HOME_ENV, RELEASES_HOME_ENV, RELEASES_DATA_DIR_ENV]) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/**
 * Effective data dir: an explicit `dataDir` argument wins; otherwise an
 * exact-app override (`HASNA_RELEASES_HOME`, `RELEASES_HOME`, or the legacy
 * `RELEASES_DATA_DIR`) wins unconditionally; otherwise the resolver data home
 * once adopted; otherwise the legacy `~/.hasna/releases` default.
 */
export function resolveDataDir(dataDirOverride?: string): string {
  const resolved =
    dataDirOverride?.trim() ||
    exactReleasesHome() ||
    (adoptResolverHome(resolverHome()) ? resolverHome() : DEFAULT_DATA_DIR);
  mkdirSync(resolved, { recursive: true });
  return resolved;
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
