export declare const STORAGE_MODES: readonly ["local", "cloud"];
export type StorageMode = (typeof STORAGE_MODES)[number];
export declare const DEPRECATED_STORAGE_MODE_ALIASES: readonly ["remote", "hybrid", "self_hosted"];
export type Env = Record<string, string | undefined>;
export interface StorageModeNormalization {
    mode: StorageMode;
    deprecatedAlias: string | null;
}
export interface StorageEnvKeys {
    modeKeys: string[];
    databaseUrlKeys: string[];
}
export interface StorageModeResolution {
    mode: StorageMode;
    source: string;
    deprecatedAlias: string | null;
    databaseUrlPresent: boolean;
    databaseUrlSource: string | null;
    warning: string | null;
}
export declare function normalizeStorageMode(value: string): StorageModeNormalization;
export declare function envToken(name: string): string;
export declare function storageEnvKeys(name: string): StorageEnvKeys;
export declare function resolveStorageMode(name: string, env?: Env): StorageModeResolution;
export declare function resolveDatabaseUrl(name: string, env?: Env): string | null;
