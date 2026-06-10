import type { TodosStorageAdapter } from "./interfaces.js";
import { createLocalSqliteTodosStorageAdapter, type CreateLocalSqliteTodosStorageAdapterOptions } from "./local-sqlite.js";
import {
  createHybridTodosStorageAdapter,
  type CreateHybridTodosStorageAdapterOptions,
} from "./hybrid.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import type { PostgresTodosSyncStore, TodosPostgresQueryClient } from "./postgres-sync.js";
import {
  assertTodosRemoteStorageConfig,
  loadTodosStorageConfig,
  type TodosStorageConfig,
  type TodosStorageEnv,
} from "./config.js";

export interface CreateTodosStorageAdapterOptions {
  config?: TodosStorageConfig;
  env?: TodosStorageEnv;
  local?: CreateLocalSqliteTodosStorageAdapterOptions;
  remoteAdapter?: TodosStorageAdapter;
  hybridAdapter?: TodosStorageAdapter;
  postgresClient?: TodosPostgresQueryClient;
  postgresSyncStore?: PostgresTodosSyncStore;
  hybrid?: Omit<CreateHybridTodosStorageAdapterOptions, "local" | "postgresClient" | "syncStore">;
}

export function createTodosStorageAdapter(options: CreateTodosStorageAdapterOptions = {}): TodosStorageAdapter {
  const config = options.config ?? loadTodosStorageConfig(options.env);
  if (config.mode === "local") return createLocalSqliteTodosStorageAdapter(options.local);

  assertTodosRemoteStorageConfig(config);

  const adapter = config.mode === "hybrid"
    ? options.hybridAdapter ?? createImplicitHybridAdapter(options) ?? options.remoteAdapter
    : options.remoteAdapter ?? createImplicitPostgresAdapter(options);

  if (!adapter) {
    throw new Error(
      `${config.mode} storage requires a repo-native remote adapter. ` +
        "Pass remoteAdapter/hybridAdapter after wiring Postgres RDS and S3 support.",
    );
  }
  assertRemoteAdapterCapabilities(adapter, config.mode);
  return adapter;
}

function createImplicitPostgresAdapter(options: CreateTodosStorageAdapterOptions): TodosStorageAdapter | null {
  if (!options.postgresClient) return null;
  return createPostgresTodosStorageAdapter({
    client: options.postgresClient,
    ...(options.hybrid?.sourceMachineId ? { sourceMachineId: options.hybrid.sourceMachineId } : {}),
  });
}

function createImplicitHybridAdapter(options: CreateTodosStorageAdapterOptions): TodosStorageAdapter | null {
  if (!options.postgresClient && !options.postgresSyncStore) return null;
  return createHybridTodosStorageAdapter({
    ...(options.hybrid ?? {}),
    local: options.local,
    postgresClient: options.postgresClient,
    syncStore: options.postgresSyncStore,
  });
}

function assertRemoteAdapterCapabilities(adapter: TodosStorageAdapter, mode: "remote" | "hybrid"): void {
  if (!adapter.capabilities.remotePersistence) {
    throw new Error(`${mode} storage adapter must set capabilities.remotePersistence=true`);
  }
  if (mode === "hybrid" && !adapter.capabilities.localPersistence) {
    throw new Error("hybrid storage adapter must also set capabilities.localPersistence=true");
  }
}
