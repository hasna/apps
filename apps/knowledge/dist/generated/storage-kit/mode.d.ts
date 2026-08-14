export declare const STORAGE_MODES: readonly ["sqlite", "postgres"];
export type StorageMode = (typeof STORAGE_MODES)[number];
export type Env = Record<string, string | undefined>;
export interface StorageModeNormalization {
    mode: StorageMode;
}
/**
 * Normalize a raw storage-backend string to the `sqlite | postgres` enum.
 * `postgresql` is accepted as the long spelling of `postgres`. Throws on any
 * other value with a migration hint.
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
    /** Env key the backend came from, or `"default"`. */
    source: string;
    databaseUrlPresent: boolean;
    /** Env key the database URL came from, or `null`. */
    databaseUrlSource: string | null;
    warning: string | null;
}
/**
 * Resolve an app's storage backend from the environment per the contract env
 * spec. Precedence: `HASNA_<NAME>_STORAGE_MODE`, then `<NAME>_STORAGE_MODE`;
 * absent both, a present `DATABASE_URL` selects `postgres`, else `sqlite`.
 * Never reads secret values — only detects DATABASE_URL presence.
 */
export declare function resolveStorageMode(name: string, env?: Env): StorageModeResolution;
/**
 * Resolve the database URL value for an app, honoring the canonical then alias
 * env keys. Returns `null` when unset. The caller is responsible for never
 * logging the returned value.
 */
export declare function resolveDatabaseUrl(name: string, env?: Env): string | null;
