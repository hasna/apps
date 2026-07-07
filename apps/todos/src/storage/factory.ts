import type { TodosStorageAdapter } from "./interfaces.js";
import { createLocalSqliteTodosStorageAdapter, type CreateLocalSqliteTodosStorageAdapterOptions } from "./local-sqlite.js";
import {
  createHybridTodosStorageAdapter,
  type CreateHybridTodosStorageAdapterOptions,
} from "./hybrid.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import type { PostgresTodosSyncStore, TodosPostgresQueryClient } from "./postgres-sync.js";
import {
  createShadowTodosStorageAdapter,
  type CreateShadowTodosStorageAdapterOptions,
} from "./shadow.js";
import { createTodosCloudQueryClientFromEnv } from "./cloud-client.js";
import {
  assertTodosRemoteStorageConfig,
  assertTodosShadowConfig,
  isTodosShadowEnabled,
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
    if (isTodosShadowEnabled(options.env)) return createShadowAdapter(options, config);
    return createLocalSqliteTodosStorageAdapter(options.local);
  }

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

function createShadowAdapter(
  options: CreateTodosStorageAdapterOptions,
  config: TodosStorageConfig,
): TodosStorageAdapter {
  assertTodosShadowConfig(config, options.env);
  const postgresClient = options.postgresClient ?? createTodosCloudQueryClientFromEnv(options.env);
  if (!options.postgresSyncStore && !postgresClient) {
    throw new Error(
      "shadow mirror requires a remote database URL or an injected Postgres client",
    );
  }
  return createShadowTodosStorageAdapter({
    ...(options.shadow ?? {}),
    ...(options.local ? { local: options.local } : {}),
    ...(options.postgresSyncStore ? { syncStore: options.postgresSyncStore } : {}),
    ...(postgresClient ? { postgresClient } : {}),
    ...(options.hybrid?.sourceMachineId ? { sourceMachineId: options.hybrid.sourceMachineId } : {}),
  });
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
