import type { TodosStorageAdapter } from "./interfaces.js";
import { createLocalSqliteTodosStorageAdapter, type CreateLocalSqliteTodosStorageAdapterOptions } from "./local-sqlite.js";
import type { CreateHybridTodosStorageAdapterOptions } from "./hybrid.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import type { PostgresTodosSyncStore, TodosPostgresQueryClient } from "./postgres-sync.js";
import type { CreateShadowTodosStorageAdapterOptions } from "./shadow.js";
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
  shadow?: Omit<CreateShadowTodosStorageAdapterOptions, "local" | "localAdapter" | "postgresClient" | "syncStore">;
}

export function createTodosStorageAdapter(options: CreateTodosStorageAdapterOptions = {}): TodosStorageAdapter {
  const config = options.config ?? loadTodosStorageConfig(options.env);
  if (config.mode === "local") {
    return createLocalSqliteTodosStorageAdapter(options.local);
  }

  assertTodosRemoteStorageConfig(config);

  const adapter = options.remoteAdapter ?? createImplicitPostgresAdapter(options);

  if (!adapter) {
    throw new Error(
      `${config.mode} storage requires a repo-native remote adapter. ` +
        "Pass remoteAdapter/hybridAdapter after wiring Postgres RDS and S3 support.",
    );
  }
  assertRemoteAdapterCapabilities(adapter);
  return adapter;
}

function createImplicitPostgresAdapter(options: CreateTodosStorageAdapterOptions): TodosStorageAdapter | null {
  if (!options.postgresClient) return null;
  return createPostgresTodosStorageAdapter({
    client: options.postgresClient,
    ...(options.hybrid?.sourceMachineId ? { sourceMachineId: options.hybrid.sourceMachineId } : {}),
  });
}

function assertRemoteAdapterCapabilities(adapter: TodosStorageAdapter): void {
  if (!adapter.capabilities.remotePersistence) {
    throw new Error("cloud storage adapter must set capabilities.remotePersistence=true");
  }
}
