export declare const STORAGE_MODES: readonly ["local", "cloud"];
export type StorageMode = (typeof STORAGE_MODES)[number];
export declare const DEPRECATED_STORAGE_MODE_ALIASES: readonly ["remote", "hybrid", "self_hosted"];
export type Env = Record<string, string | undefined>;
export interface StorageModeNormalization {
    mode: StorageMode;
    /** The deprecated alias that was normalized to `cloud`, if any. */
    deprecatedAlias: string | null;
}
/**
 * Normalize a raw storage-mode string to the `local | cloud` runtime enum.
 * Accepts deprecated aliases (`remote`, `hybrid`, `self_hosted`) and maps them
 * to `cloud`. Throws on any other value.
 */
export declare function normalizeStorageMode(value: string): StorageModeNormalization;
/** Upper-snake env token for an app name, e.g. `todos` -> `TODOS`. */
export declare function envToken(name: string): string;
export interface StorageEnvKeys {
    /** `HASNA_<NAME>_STORAGE_MODE` then the optional `<NAME>_STORAGE_MODE` alias. */
    modeKeys: string[];
    /** `HASNA_<NAME>_DATABASE_URL` then the optional `<NAME>_DATABASE_URL` alias. */
    databaseUrlKeys: string[];
}
/** Resolve the canonical env-key spec for an app's storage config. */
export declare function storageEnvKeys(name: string): StorageEnvKeys;
export interface StorageModeResolution {
    mode: StorageMode;
    /** Env key the mode came from, or `"default"`. */
    source: string;
    deprecatedAlias: string | null;
    databaseUrlPresent: boolean;
    /** Env key the database URL came from, or `null`. */
    databaseUrlSource: string | null;
    warning: string | null;
}
/**
 * Resolve an app's storage mode from the environment per the contract env spec.
 * Precedence: `HASNA_<NAME>_STORAGE_MODE`, then `<NAME>_STORAGE_MODE`, else
 * `local`. Never reads secret values — only detects DATABASE_URL presence.
 */
export declare function resolveStorageMode(name: string, env?: Env): StorageModeResolution;
/**
 * Resolve the database URL value for an app, honoring the canonical then alias
 * env keys. Returns `null` when unset. The caller is responsible for never
 * logging the returned value.
 */
export declare function resolveDatabaseUrl(name: string, env?: Env): string | null;
