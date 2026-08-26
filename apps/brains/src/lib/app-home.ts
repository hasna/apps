import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/** Env var names for the exact-app data-home overrides. */
export const HASNA_BRAINS_DIR_ENV = "HASNA_BRAINS_DIR";
export const HASNA_BRAINS_HOME_ENV = "HASNA_BRAINS_HOME";

/**
 * The effective user home, mirroring the pre-existing brains resolution
 * (`HOME` || `USERPROFILE` || `os.homedir()`). Read at call time because the
 * config/CLI tests switch `$HOME` mid-process and bun's `os.homedir()` does
 * not follow that switch.
 */
/** The effective user home, exported for the legacy `.brains` migration sites. */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

/**
 * Pre-XDG default home: ~/.hasna/brains. Resolved at call time (not module
 * load) so switching $HOME mid-process keeps working.
 */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "brains");
}

/**
 * The @hasna/paths-resolved data home for brains (XDG / macOS home layout).
 * The home override mirrors the pre-existing `$HOME`-first resolution so the
 * resolver follows the same home the legacy path does.
 */
export function resolverHome(): string {
  return dataDir({ app: "brains", home: process.env["HOME"] || process.env["USERPROFILE"] || undefined });
}

/**
 * Whether the resolver (XDG) home should be adopted as the store home. The
 * resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the
 * store has already been physically migrated there (`brains.db` exists). A
 * machine that only redirects another kind (e.g. cache to tmpfs) must NOT
 * have its data home moved, and a live store at the legacy home must never
 * become invisible on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "brains.db"));
}

/** The exact-app override root, when set: `HASNA_BRAINS_DIR` wins over `HASNA_BRAINS_HOME`. */
export function exactBrainsHome(): string | undefined {
  const dir = process.env[HASNA_BRAINS_DIR_ENV];
  if (dir && dir.trim()) return dir.trim();
  const home = process.env[HASNA_BRAINS_HOME_ENV];
  if (home && home.trim()) return home.trim();
  return undefined;
}

/**
 * Effective brains data home: an exact-app override (`HASNA_BRAINS_DIR`, then
 * the `HASNA_BRAINS_HOME` fallback) wins unconditionally; otherwise the
 * resolver (XDG) data home once adopted; otherwise the legacy
 * `~/.hasna/brains` default.
 */
export function getBrainsHome(): string {
  const exact = exactBrainsHome();
  if (exact) return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(legacyHomeDir());
}

/** The datasets directory at the effective brains data home. */
export function getBrainsDatasetsDir(): string {
  return join(getBrainsHome(), "datasets");
}

/** The config file at the effective brains data home. */
export function getBrainsConfigPath(): string {
  return join(getBrainsHome(), "config.json");
}

/** The remote-storage config file at the effective brains data home. */
export function getBrainsStorageConfigPath(): string {
  return join(getBrainsHome(), "storage", "config.json");
}
