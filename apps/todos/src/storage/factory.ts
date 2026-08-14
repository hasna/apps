import type { TodosStorageAdapter } from "./interfaces.js";
import { createLocalSqliteTodosStorageAdapter, type CreateLocalSqliteTodosStorageAdapterOptions } from "./local-sqlite.js";
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
  /** Injected Postgres-backed adapter (test seam / custom wiring). */
  remoteAdapter?: TodosStorageAdapter;
  postgresClient?: TodosPostgresQueryClient;
  postgresSyncStore?: PostgresTodosSyncStore;
  /** Stable machine identity stamped onto mirrored/synced rows. */
  sourceMachineId?: string;
  shadow?: Omit<CreateShadowTodosStorageAdapterOptions, "local" | "localAdapter" | "postgresClient" | "syncStore">;
}

/**
 * The single data-backend switch: exactly two arms — the local SQLite file or
 * PostgreSQL. There is no deployment-mode arm; the migration-era hybrid
 * dual-write adapter is reachable only through its explicit constructor
 * (`createHybridTodosStorageAdapter`), never through this switch.
 */
export function createTodosStorageAdapter(options: CreateTodosStorageAdapterOptions = {}): TodosStorageAdapter {
  const config = options.config ?? loadTodosStorageConfig(options.env);
  if (config.mode === "sqlite") {
    if (isTodosShadowEnabled(options.env)) return createShadowAdapter(options, config);
    return createLocalSqliteTodosStorageAdapter(options.local);
  }

  assertTodosRemoteStorageConfig(config);

  const adapter = options.remoteAdapter ?? createImplicitPostgresAdapter(options);
  if (!adapter) {
    throw new Error(
      "postgres storage requires a repo-native Postgres adapter. " +
        "Pass remoteAdapter or postgresClient after wiring Postgres RDS support.",
    );
  }
  assertPostgresAdapterCapabilities(adapter);
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
    ...(options.sourceMachineId ? { sourceMachineId: options.sourceMachineId } : {}),
  });
}

function createImplicitPostgresAdapter(options: CreateTodosStorageAdapterOptions): TodosStorageAdapter | null {
  if (!options.postgresClient) return null;
  return createPostgresTodosStorageAdapter({
    client: options.postgresClient,
    ...(options.sourceMachineId ? { sourceMachineId: options.sourceMachineId } : {}),
  });
}

function assertPostgresAdapterCapabilities(adapter: TodosStorageAdapter): void {
  if (!adapter.capabilities.remotePersistence) {
    throw new Error("postgres storage adapter must set capabilities.remotePersistence=true");
  }
}
