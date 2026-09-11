import { type Env } from "../env-token.js";
export declare const APP_HOME_SCOPES: readonly ["public", "internal"];
export type AppHomeScope = (typeof APP_HOME_SCOPES)[number];
export declare const HASNA_HOME_ENV_KEY = "HASNA_HOME";
export declare const HASNA_CONFIG_HOME_ENV_KEY = "HASNA_CONFIG_HOME";
export declare const HASNA_DATA_HOME_ENV_KEY = "HASNA_DATA_HOME";
export declare const HASNA_STATE_HOME_ENV_KEY = "HASNA_STATE_HOME";
export declare const HASNA_CACHE_HOME_ENV_KEY = "HASNA_CACHE_HOME";
/** Every override this resolver honours. Nothing else moves an app home. */
export declare const APP_HOME_ENV_KEYS: readonly ["HASNA_HOME", "HASNA_CONFIG_HOME", "HASNA_DATA_HOME", "HASNA_STATE_HOME", "HASNA_CACHE_HOME"];
export declare const PUBLIC_HOME_DIR_NAME = ".hasna";
export declare const INTERNAL_HOME_DIR_NAME = ".hasna-internal";
export declare const APP_CONFIG_SUBDIR = "config";
export declare const APP_STATE_SUBDIR = "state";
export declare const APP_CACHE_SUBDIR = "cache";
export declare const APP_CREDENTIALS_FILE = "credentials";
/**
 * An app name that is safe to put in a filesystem path — the same grammar as
 * the DNS label the transport requires. Checked here because this module is a
 * FILESYSTEM sink.
 */
export declare const APP_HOME_SLUG_PATTERN: RegExp;
/** The scope for a package name: `@hasna/*` is public, `@hasna-internal/*` is internal, anything else is unknown. */
export declare function appScopeForPackageName(packageName: string): AppHomeScope | null;
/** `.hasna` or `.hasna-internal`. */
export declare function scopeHomeDirName(scope: AppHomeScope): string;
export interface ResolveAppHomeOptions {
    /** Defaults to `"public"`. Internal apps pass `"internal"` (from `hasna.contract.json` `scope`). */
    scope?: AppHomeScope;
}
export interface AppHomeSources {
    /** What anchored the scope root: `HASNA_HOME` or `HOME`. */
    root: string;
    /** What decided the config layer: `HASNA_CONFIG_HOME` or the home. */
    config: string;
    data: string;
    state: string;
    cache: string;
}
export interface AppHome {
    name: string;
    scope: AppHomeScope;
    /** The scope root: `~/.hasna` or `~/.hasna-internal` (or `HASNA_HOME`). */
    root: string;
    /** `<root>/<app>` — the app home. Data lives here. */
    home: string;
    /** `<home>/config` (or `<HASNA_CONFIG_HOME>/<app>`). */
    config: string;
    /** `<config>/credentials` — read by the credential resolver, written only by provisioning. */
    credentials: string;
    /** `<home>` (or `<HASNA_DATA_HOME>/<app>`). */
    data: string;
    /** `<home>/state` (or `<HASNA_STATE_HOME>/<app>`). */
    state: string;
    /** `<home>/cache` (or `<HASNA_CACHE_HOME>/<app>`). */
    cache: string;
    /** `<data>/<app>.db` — the ONLY place an opted-in on-box store may live. */
    localDb: string;
    /** Env key NAMES that decided each layer. Never values. */
    sources: AppHomeSources;
}
/** Thrown by {@link appPaths} when no HOME or HASNA_HOME anchors a root, or the name is unsafe. */
export declare class AppHomeUnresolvableError extends Error {
    readonly appName: string;
    constructor(appName: string, message: string);
}
/**
 * Resolve an app's home and sub-layers, or `null` when neither `HOME` nor
 * `HASNA_HOME` anchors a root. Throws only for a name that is not a safe slug.
 */
export declare function resolveAppHome(name: string, env?: Env, options?: ResolveAppHomeOptions): AppHome | null;
/**
 * {@link resolveAppHome} that THROWS when no root can be anchored — for
 * callers about to open the on-box store, where "no home" is not a place to
 * write.
 */
export declare function appPaths(name: string, env?: Env, options?: ResolveAppHomeOptions): AppHome;
