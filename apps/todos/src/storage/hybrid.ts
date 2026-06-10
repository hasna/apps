import {
  createPostgresTodosSyncStore,
  type PostgresTodosSyncPushResult,
  type PostgresTodosSyncStore,
  type PullPostgresTodosSnapshotOptions,
  type TodosPostgresQueryClient,
} from "./postgres-sync.js";
import {
  createLocalSqliteTodosStorageAdapter,
  type CreateLocalSqliteTodosStorageAdapterOptions,
} from "./local-sqlite.js";
import type {
  TodosStorageAdapter,
  TodosStorageContext,
  TodosStorageImportResult,
  TodosStorageSnapshot,
} from "./interfaces.js";

export interface HybridTodosStorageSyncResult {
  pulled: TodosStorageImportResult;
  pushed: PostgresTodosSyncPushResult;
}

export interface HybridTodosRemoteSync {
  ensureSchema(): Promise<void>;
  pushSnapshot(context?: TodosStorageContext): Promise<PostgresTodosSyncPushResult>;
  pullSnapshot(options?: PullPostgresTodosSnapshotOptions, context?: TodosStorageContext): Promise<TodosStorageImportResult>;
  syncOnce(options?: PullPostgresTodosSnapshotOptions, context?: TodosStorageContext): Promise<HybridTodosStorageSyncResult>;
}

export interface HybridTodosStorageAdapter extends TodosStorageAdapter {
  readonly kind: "hybrid";
  readonly remote: HybridTodosRemoteSync;
}

export interface CreateHybridTodosStorageAdapterOptions {
  localAdapter?: TodosStorageAdapter;
  local?: CreateLocalSqliteTodosStorageAdapterOptions;
  syncStore?: PostgresTodosSyncStore;
  postgresClient?: TodosPostgresQueryClient;
  sourceMachineId?: string;
}

export function createHybridTodosStorageAdapter(
  options: CreateHybridTodosStorageAdapterOptions,
): HybridTodosStorageAdapter {
  const local = options.localAdapter ?? createLocalSqliteTodosStorageAdapter(options.local);
  const syncStore = options.syncStore ?? (
    options.postgresClient
      ? createPostgresTodosSyncStore(options.postgresClient, { sourceMachineId: options.sourceMachineId })
      : null
  );
  if (!syncStore) throw new Error("hybrid storage requires a Postgres sync store or query client");
  if (!local.sync.exportSnapshot || !local.sync.importSnapshot) {
    throw new Error("hybrid storage requires local snapshot export/import support");
  }

  const exportSnapshot = async (context?: TodosStorageContext): Promise<TodosStorageSnapshot> =>
    await local.sync.exportSnapshot!(context);

  const importSnapshot = async (
    snapshot: TodosStorageSnapshot,
    context?: TodosStorageContext,
  ): Promise<TodosStorageImportResult> => await local.sync.importSnapshot!(snapshot, context);

  const remote: HybridTodosRemoteSync = {
    ensureSchema: () => syncStore.ensureSchema(),
    async pushSnapshot(context) {
      const snapshot = await exportSnapshot(context);
      return syncStore.pushSnapshot(snapshot, context);
    },
    async pullSnapshot(options, context) {
      const snapshot = await syncStore.pullSnapshot(options);
      return importSnapshot(snapshot, context);
    },
    async syncOnce(options, context) {
      const pulled = await remote.pullSnapshot(options, context);
      const pushed = await remote.pushSnapshot(context);
      return { pulled, pushed };
    },
  };

  return {
    ...local,
    kind: "hybrid",
    capabilities: {
      ...local.capabilities,
      localPersistence: true,
      remotePersistence: true,
      sync: true,
    },
    sync: {
      ...local.sync,
      exportSnapshot,
      importSnapshot,
    },
    remote,
  };
}
