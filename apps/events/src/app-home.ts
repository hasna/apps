import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/** Env var names for the exact-app data-home overrides (preserved, highest precedence). */
export const HASNA_EVENTS_DIR_ENV = "HASNA_EVENTS_DIR";
export const HASNA_EVENTS_HOME_ENV = "HASNA_EVENTS_HOME";

/** The primary store file — its existence at a home marks the store as physically located there. */
export const EVENTS_STORE_SENTINEL_FILE = "events.json";

/** The effective user home, mirroring the pre-existing events resolution (`HOME` || `USERPROFILE` || `os.homedir()`). */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

/** Pre-XDG default home: ~/.hasna/events. */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "events");
}

/**
 * The @hasna/paths-resolved data home for events (XDG / macOS home layout).
 * The `home` is injected so the resolver follows the same home the legacy path
 * does (`$HOME`-first, matching the pre-existing resolution).
 */
export function resolverHome(): string {
  return dataDir({ app: "events", home: effectiveHome() || undefined });
}

/**
 * Whether the resolver (XDG) home should be adopted as the store home. The
 * resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the
 * store has already been physically migrated there (`events.json` exists). A
 * machine that only redirects another kind must NOT have its data home moved,
 * and a live store at the legacy home must never become invisible on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, EVENTS_STORE_SENTINEL_FILE));
}

/** The exact-app override root (`HASNA_EVENTS_DIR` wins over `HASNA_EVENTS_HOME`), when set. Empty values are treated as unset. */
export function exactEventsHome(): string | undefined {
  const dir = process.env[HASNA_EVENTS_DIR_ENV];
  if (dir && dir.trim()) return dir.trim();
  const home = process.env[HASNA_EVENTS_HOME_ENV];
  if (home && home.trim()) return home.trim();
  return undefined;
}

/**
 * Effective events data home: an exact-app override (`HASNA_EVENTS_DIR`, then
 * the legacy `HASNA_EVENTS_HOME` fallback) wins unconditionally; otherwise the
 * resolver (XDG) data home once adopted; otherwise the legacy `~/.hasna/events`
 * default.
 */
export function getEventsHome(): string {
  const exact = exactEventsHome();
  if (exact) return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(legacyHomeDir());
}
