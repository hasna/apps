import {
  recordRuntimeEvent as rawRecordRuntimeEvent,
  syncMachineRegistryFromManifest as rawSyncMachineRegistryFromManifest,
  upsertMachineRegistrySnapshot as rawUpsertMachineRegistrySnapshot,
  type MachineRegistrySnapshot,
  type RuntimeEventInput,
  type RuntimeEventSeverity,
  type RuntimeEventStatus,
  type StoredMachineRegistry,
  type StoredRuntimeEvent,
} from "./db.js";
import {
  MACHINES_STORAGE_ENV,
  MACHINES_STORAGE_FALLBACK_ENV,
  MACHINES_STORAGE_MODE_ENV,
  MACHINES_STORAGE_MODE_FALLBACK_ENV,
  MACHINES_STORAGE_TABLES,
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
import type { FleetManifest } from "./types.js";
import type { StorageEnv, StorageMode, StorageStatus, SyncMeta, SyncResult } from "./storage-sync.js";

export type StorageMutationOptions = SdkMutationApprovalOptions & {
  tables?: string[];
};

export type MachineRegistrySyncOptions = SdkMutationApprovalOptions & {
  manifest?: FleetManifest;
  sourceKind?: string;
  sourceRef?: string | null;
};

export type MachineRegistrySnapshotOptions = SdkMutationApprovalOptions;
export type RuntimeEventRecordOptions = SdkMutationApprovalOptions;

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

function registrySyncArgs(options: MachineRegistrySyncOptions = {}): Record<string, unknown> {
  return {
    source_kind: options.sourceKind ?? "manifest",
    source_ref: options.sourceRef ?? null,
    manifest_machine_count: options.manifest?.machines.length ?? null,
  };
}

function registrySnapshotArgs(snapshot: MachineRegistrySnapshot): Record<string, unknown> {
  return {
    machine_id: snapshot.machineId,
    platform: snapshot.platform,
    connection: snapshot.connection ?? null,
    declared: snapshot.declared !== false,
    source_kind: snapshot.sourceKind ?? "manifest",
    source_ref: snapshot.sourceRef ?? null,
    snapshot_digest: mutationArgsSha256({
      tags: snapshot.tags ?? [],
      capabilities: snapshot.capabilities ?? {},
      updated_at: snapshot.updatedAt ?? null,
      manifest_updated_at: snapshot.manifestUpdatedAt ?? null,
    }),
    private_metadata: snapshot.privateMetadata === true,
  };
}

function runtimeEventArgs(input: RuntimeEventInput): Record<string, unknown> {
  return {
    event_id: input.eventId ?? null,
    machine_id: input.machineId,
    event_type: input.eventType,
    severity: input.severity ?? "warning",
    status: input.status ?? "open",
    source: input.source ?? "machines",
    dedupe_key: input.dedupeKey ?? null,
    event_digest: mutationArgsSha256({
      subject: input.subject ?? null,
      message: input.message,
      data: input.data ?? {},
      resolved_at: input.resolvedAt ?? null,
    }),
    private_metadata: input.privateMetadata === true,
  };
}

export async function runStorageMigrations(
  remote: StorageMigrationAdapter,
  options: SdkMutationApprovalOptions = {},
): Promise<void> {
  assertSdkMutationApproved({
    operation: "machines_storage_migrate",
    resourceId: "storage:migrations",
    args: {},
  }, options);
  return rawRunStorageMigrations(remote as Parameters<typeof rawRunStorageMigrations>[0]);
}

export async function storagePush(options: StorageMutationOptions = {}): Promise<SyncResult[]> {
  assertSdkMutationApproved({
    operation: "machines_storage_push",
    resourceId: storageResourceId("push", options),
    args: storageArgs(options),
  }, options);
  return rawStoragePush({ tables: options.tables });
}

export async function storagePull(options: StorageMutationOptions = {}): Promise<SyncResult[]> {
  assertSdkMutationApproved({
    operation: "machines_storage_pull",
    resourceId: storageResourceId("pull", options),
    args: storageArgs(options),
  }, options);
  return rawStoragePull({ tables: options.tables });
}

export async function storageSync(options: StorageMutationOptions = {}): Promise<{ pull: SyncResult[]; push: SyncResult[] }> {
  assertSdkMutationApproved({
    operation: "machines_storage_sync",
    resourceId: storageResourceId("sync", options),
    args: storageArgs(options),
  }, options);
  return rawStorageSync({ tables: options.tables });
}

export function syncMachineRegistryFromManifest(options: MachineRegistrySyncOptions = {}): StoredMachineRegistry[] {
  const args = registrySyncArgs(options);
  assertSdkMutationApproved({
    operation: "machines_registry_sync",
    resourceId: `registry:manifest:${mutationArgsSha256(args)}`,
    args,
  }, options);
  return rawSyncMachineRegistryFromManifest(options.manifest, {
    sourceKind: options.sourceKind,
    sourceRef: options.sourceRef,
  });
}

export function upsertMachineRegistrySnapshot(
  snapshot: MachineRegistrySnapshot,
  options: MachineRegistrySnapshotOptions = {},
): StoredMachineRegistry {
  const args = registrySnapshotArgs(snapshot);
  assertSdkMutationApproved({
    operation: "machines_registry_upsert",
    machineId: snapshot.machineId,
    resourceId: `registry:machine:${snapshot.machineId}:${mutationArgsSha256(args)}`,
    args,
  }, options);
  return rawUpsertMachineRegistrySnapshot(snapshot);
}

export function recordRuntimeEvent(input: RuntimeEventInput, options: RuntimeEventRecordOptions = {}): StoredRuntimeEvent {
  const args = runtimeEventArgs(input);
  assertSdkMutationApproved({
    operation: "machines_runtime_event_record",
    machineId: input.machineId,
    resourceId: `runtime-event:${input.eventId ?? input.dedupeKey ?? input.machineId}:${mutationArgsSha256(args)}`,
    args,
  }, options);
  return rawRecordRuntimeEvent(input);
}

export {
  MACHINES_STORAGE_ENV,
  MACHINES_STORAGE_FALLBACK_ENV,
  MACHINES_STORAGE_MODE_ENV,
  MACHINES_STORAGE_MODE_FALLBACK_ENV,
  MACHINES_STORAGE_TABLES,
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
export type {
  MachineRegistrySnapshot,
  RuntimeEventInput,
  RuntimeEventSeverity,
  RuntimeEventStatus,
  StoredMachineRegistry,
  StoredRuntimeEvent,
};
export { PG_MIGRATIONS } from "./pg-migrations.js";
