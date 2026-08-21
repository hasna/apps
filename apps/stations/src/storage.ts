import {
  STATIONS_STORAGE_ENV,
  STATIONS_STORAGE_FALLBACK_ENV,
  STATIONS_STORAGE_MODE_ENV,
  STATIONS_STORAGE_MODE_FALLBACK_ENV,
  STATIONS_STORAGE_TABLES,
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  STORAGE_TABLES,
  getStorageDatabaseEnv,
  getStorageDatabaseEnvName,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageStatus,
  getSyncMetaAll,
  parseStorageTables,
  resolveTables,
  runStorageMigrations as rawRunStorageMigrations,
  storagePull as rawStoragePull,
  storagePush as rawStoragePush,
  storageSync as rawStorageSync,
} from "./storage-sync.js";
import { assertSdkMutationApproved, mutationArgsSha256, type SdkMutationApprovalOptions } from "./commands/mutation-approval.js";
import type { StorageEnv, StorageMode, StorageStatus, SyncMeta, SyncResult } from "./storage-sync.js";

export type StorageMutationOptions = SdkMutationApprovalOptions & {
  tables?: string[];
};

export type StorageMigrationAdapter = {
  run(sql: string, ...params: unknown[]): Promise<unknown>;
};

function storageArgs(options: StorageMutationOptions = {}): Record<string, unknown> {
  return {
    tables: options.tables?.length ? [...options.tables] : null,
  };
}

function storageResourceId(operation: string, options: StorageMutationOptions = {}): string {
  return `storage:${operation}:${mutationArgsSha256(storageArgs(options))}`;
}

export async function runStorageMigrations(
  remote: StorageMigrationAdapter,
  options: SdkMutationApprovalOptions = {},
): Promise<void> {
  assertSdkMutationApproved({
    operation: "stations_storage_migrate",
    resourceId: "storage:migrations",
    args: {},
  }, options);
  return rawRunStorageMigrations(remote as Parameters<typeof rawRunStorageMigrations>[0]);
}

export async function storagePush(options: StorageMutationOptions = {}): Promise<SyncResult[]> {
  assertSdkMutationApproved({
    operation: "stations_storage_push",
    resourceId: storageResourceId("push", options),
    args: storageArgs(options),
  }, options);
  return rawStoragePush({ tables: options.tables });
}

export async function storagePull(options: StorageMutationOptions = {}): Promise<SyncResult[]> {
  assertSdkMutationApproved({
    operation: "stations_storage_pull",
    resourceId: storageResourceId("pull", options),
    args: storageArgs(options),
  }, options);
  return rawStoragePull({ tables: options.tables });
}

export async function storageSync(options: StorageMutationOptions = {}): Promise<{ pull: SyncResult[]; push: SyncResult[] }> {
  assertSdkMutationApproved({
    operation: "stations_storage_sync",
    resourceId: storageResourceId("sync", options),
    args: storageArgs(options),
  }, options);
  return rawStorageSync({ tables: options.tables });
}

export {
  STATIONS_STORAGE_ENV,
  STATIONS_STORAGE_FALLBACK_ENV,
  STATIONS_STORAGE_MODE_ENV,
  STATIONS_STORAGE_MODE_FALLBACK_ENV,
  STATIONS_STORAGE_TABLES,
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  STORAGE_TABLES,
  getStorageDatabaseEnv,
  getStorageDatabaseEnvName,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageStatus,
  getSyncMetaAll,
  parseStorageTables,
  resolveTables,
};
export type { StorageEnv, StorageMode, StorageStatus, SyncMeta, SyncResult };
export { PG_MIGRATIONS } from "./pg-migrations.js";
