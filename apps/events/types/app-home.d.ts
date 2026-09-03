export type PathKind = "config" | "data" | "state" | "cache";
export interface PathsResolverOptions {
    app: string;
    internal?: boolean;
    platform?: string;
    home?: string;
    env?: Record<string, string | undefined>;
}
export declare function dataDir(options: PathsResolverOptions): string;
/** Env var names for the exact-app data-home overrides (preserved, highest precedence). */
export declare const HASNA_EVENTS_DIR_ENV = "HASNA_EVENTS_DIR";
export declare const HASNA_EVENTS_HOME_ENV = "HASNA_EVENTS_HOME";
/** The primary store file — its existence at a home marks the store as physically located there. */
export declare const EVENTS_STORE_SENTINEL_FILE = "events.json";
/** The effective user home, mirroring the pre-existing events resolution (`HOME` || `USERPROFILE` || `os.homedir()`). */
export declare function effectiveHome(): string;
/** Pre-XDG default home: ~/.hasna/events. */
export declare function legacyHomeDir(): string;
/**
 * The @hasna/paths-resolved data home for events (XDG / macOS home layout).
 * The `home` is injected so the resolver follows the same home the legacy path
 * does (`$HOME`-first, matching the pre-existing resolution).
 */
export declare function resolverHome(): string;
/**
 * Whether the resolver (XDG) home should be adopted as the store home. The
 * resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the
 * store has already been physically migrated there (`events.json` exists). A
 * machine that only redirects another kind must NOT have its data home moved,
 * and a live store at the legacy home must never become invisible on upgrade.
 */
export declare function adoptResolverHome(resolved: string, env?: NodeJS.ProcessEnv): boolean;
/** The exact-app override root (`HASNA_EVENTS_DIR` wins over `HASNA_EVENTS_HOME`), when set. Empty values are treated as unset. */
export declare function exactEventsHome(): string | undefined;
/**
 * Effective events data home: an exact-app override (`HASNA_EVENTS_DIR`, then
 * the legacy `HASNA_EVENTS_HOME` fallback) wins unconditionally; otherwise the
 * resolver (XDG) data home once adopted; otherwise the legacy `~/.hasna/events`
 * default.
 */
export declare function getEventsHome(): string;
