import { effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";
/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export declare const effectiveHome: typeof resolveEffectiveHome;
export declare const HASNA_EVENTS_DIR_ENV = "HASNA_EVENTS_DIR";
export declare const HASNA_EVENTS_HOME_ENV = "HASNA_EVENTS_HOME";
export declare const EVENTS_STORE_SENTINEL_FILE = "events.json";
/**
 * The resolver events data root: kind overrides honored,
 * `~/.hasna/events` on macOS, `~/.local/share/hasna/events` on Linux.
 */
export declare function resolverHome(): string;
/**
 * The pre-ruling legacy root (`~/.hasna/events`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export declare function legacyHomeDir(): string;
export declare function exactEventsHome(): string | undefined;
/**
 * The effective events data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export declare function getEventsHome(): string;
