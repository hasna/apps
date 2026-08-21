export type StorageMode = "local" | "cloud";
export type Env = Record<string, string | undefined>;
export interface StorageModeNormalization {
    mode: StorageMode;
}
/**
 * Normalize a raw storage-mode string to the `local | cloud` enum. Throws on
 * any other value — including the retired deployment-mode words — naming the
 * fix, so a stale env var fails loudly instead of silently picking a backend.
 */
export declare function normalizeStorageMode(value: string): StorageModeNormalization;
/** Upper-snake env token for an app name, e.g. `todos` -> `TODOS`. */
export declare function envToken(name: string): string;
