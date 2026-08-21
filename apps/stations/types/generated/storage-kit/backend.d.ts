export declare const SERVER_DATA_BACKENDS: readonly ["sqlite", "postgresql"];
export type ServerDataBackend = (typeof SERVER_DATA_BACKENDS)[number];
export type Env = Record<string, string | undefined>;
/** Upper-snake env token for an app name, e.g. `todos` -> `TODOS`. */
export declare function envToken(name: string): string;
export interface ServerDataBackendEnvKeys {
    databaseUrlKeys: string[];
}
export declare function serverDataBackendEnvKeys(name: string): ServerDataBackendEnvKeys;
export declare function assertNoLegacyStorageMode(name: string, env?: Env): void;
export interface ServerDataBackendResolution {
    backend: ServerDataBackend;
    source: string;
    databaseUrlPresent: boolean;
    databaseUrlSource: string | null;
}
export declare function resolveServerDataBackend(name: string, env?: Env): ServerDataBackendResolution;
/** Resolve the database URL without logging it. Returns `null` when unset. */
export declare function resolveDatabaseUrl(name: string, env?: Env): string | null;
