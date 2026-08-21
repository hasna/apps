import { STATIONS_STORAGE_ENV, STATIONS_STORAGE_FALLBACK_ENV, STATIONS_STORAGE_MODE_ENV, STATIONS_STORAGE_MODE_FALLBACK_ENV, STATIONS_STORAGE_TABLES, STORAGE_DATABASE_ENV, STORAGE_MODE_ENV, STORAGE_TABLES, getStorageDatabaseEnv, getStorageDatabaseEnvName, getStorageDatabaseUrl, getStorageMode, getStorageStatus, getSyncMetaAll, parseStorageTables, resolveTables } from "./storage-sync.js";
import { type SdkMutationApprovalOptions } from "./commands/mutation-approval.js";
import type { StorageEnv, StorageMode, StorageStatus, SyncMeta, SyncResult } from "./storage-sync.js";
export type StorageMutationOptions = SdkMutationApprovalOptions & {
    tables?: string[];
};
export type StorageMigrationAdapter = {
    run(sql: string, ...params: unknown[]): Promise<unknown>;
};
export declare function runStorageMigrations(remote: StorageMigrationAdapter, options?: SdkMutationApprovalOptions): Promise<void>;
export declare function storagePush(options?: StorageMutationOptions): Promise<SyncResult[]>;
export declare function storagePull(options?: StorageMutationOptions): Promise<SyncResult[]>;
export declare function storageSync(options?: StorageMutationOptions): Promise<{
    pull: SyncResult[];
    push: SyncResult[];
}>;
export { STATIONS_STORAGE_ENV, STATIONS_STORAGE_FALLBACK_ENV, STATIONS_STORAGE_MODE_ENV, STATIONS_STORAGE_MODE_FALLBACK_ENV, STATIONS_STORAGE_TABLES, STORAGE_DATABASE_ENV, STORAGE_MODE_ENV, STORAGE_TABLES, getStorageDatabaseEnv, getStorageDatabaseEnvName, getStorageDatabaseUrl, getStorageMode, getStorageStatus, getSyncMetaAll, parseStorageTables, resolveTables, };
export type { StorageEnv, StorageMode, StorageStatus, SyncMeta, SyncResult };
export { PG_MIGRATIONS } from "./pg-migrations.js";
