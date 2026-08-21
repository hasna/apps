import { PgAdapterAsync } from "./remote-storage.js";
export declare const STORAGE_TABLES: readonly ["agent_heartbeats", "setup_runs", "sync_runs"];
export declare const STATIONS_STORAGE_TABLES: readonly ["agent_heartbeats", "setup_runs", "sync_runs"];
type StorageTable = (typeof STORAGE_TABLES)[number];
/**
 * Storage mode: `local` (on-box SQLite) or `cloud` (hosted HTTP API). There is
 * no third value, and no variable selects it anymore (owner directive
 * 2026-07-29): any set storage-mode variable throws via
 * `assertNoLegacyStorageMode`.
 */
export type StorageMode = "local" | "cloud";
export interface StorageEnv {
    name: string;
}
export interface SyncResult {
    table: string;
    rowsRead: number;
    rowsWritten: number;
    errors: string[];
}
export interface SyncMeta {
    table_name: string;
    last_synced_at: string | null;
    direction: "push" | "pull";
}
export declare const STATIONS_STORAGE_ENV = "HASNA_STATIONS_DATABASE_URL";
export declare const STATIONS_STORAGE_FALLBACK_ENV = "STATIONS_DATABASE_URL";
export declare const STATIONS_STORAGE_MODE_ENV = "HASNA_STATIONS_STORAGE_MODE";
export declare const STATIONS_STORAGE_MODE_FALLBACK_ENV = "STATIONS_STORAGE_MODE";
export declare const STORAGE_DATABASE_ENV: readonly ["HASNA_STATIONS_DATABASE_URL", "STATIONS_DATABASE_URL"];
export declare const STORAGE_MODE_ENV: readonly ["HASNA_STATIONS_STORAGE_MODE", "STATIONS_STORAGE_MODE"];
export interface StorageStatus {
    configured: boolean;
    mode: StorageMode;
    env: typeof STORAGE_DATABASE_ENV;
    activeEnv: string | null;
    service: "stations";
    tables: typeof STORAGE_TABLES;
    sync: SyncMeta[];
}
export declare function getStorageDatabaseEnvName(): (typeof STORAGE_DATABASE_ENV)[number] | null;
export declare function getStorageDatabaseEnv(): StorageEnv | null;
export declare function getStorageDatabaseUrl(): string | null;
export declare function getStorageMode(): StorageMode;
export declare function getStoragePg(): Promise<PgAdapterAsync>;
export declare function runStorageMigrations(remote: PgAdapterAsync): Promise<void>;
export declare function storagePush(options?: {
    tables?: string[];
}): Promise<SyncResult[]>;
export declare function storagePull(options?: {
    tables?: string[];
}): Promise<SyncResult[]>;
export declare function storageSync(options?: {
    tables?: string[];
}): Promise<{
    pull: SyncResult[];
    push: SyncResult[];
}>;
export declare function getSyncMetaAll(): SyncMeta[];
export declare function getStorageStatus(): StorageStatus;
export declare function resolveTables(tables?: string[]): StorageTable[];
export declare function parseStorageTables(value?: string | string[] | null): StorageTable[] | undefined;
export {};
