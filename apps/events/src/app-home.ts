/**
 * events data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/events` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the events-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const effectiveHome = resolveEffectiveHome;
export const HASNA_EVENTS_DIR_ENV = "HASNA_EVENTS_DIR";
export const HASNA_EVENTS_HOME_ENV = "HASNA_EVENTS_HOME";
export const EVENTS_STORE_SENTINEL_FILE = "events.json";

/**
 * The resolver events data root: kind overrides honored,
 * `~/.hasna/events` on macOS, `~/.local/share/hasna/events` on Linux.
 */
export function resolverHome(): string {
  return resolverDataDir({ app: "events", home: effectiveHome(),  });
}

/**
 * The pre-ruling legacy root (`~/.hasna/events`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "events");
}

export function exactEventsHome(): string | undefined {
  const dir = process.env[HASNA_EVENTS_DIR_ENV];
  if (dir && dir.trim()) return dir.trim();
  const home = process.env[HASNA_EVENTS_HOME_ENV];
  if (home && home.trim()) return home.trim();
  return undefined;
}

/**
 * The effective events data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function getEventsHome(): string {
  const exact = exactEventsHome();
  if (exact) return exact;
  return resolve(resolverHome());
}
