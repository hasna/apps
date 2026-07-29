import type { TodosStorageAdapter } from "./interfaces.js";
import {
  createLocalSqliteTodosStorageAdapter,
  type CreateLocalSqliteTodosStorageAdapterOptions,
} from "./local-sqlite.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import type { TodosPostgresQueryClient } from "./postgres-sync.js";
import {
  loadTodosStorageConfig,
  type TodosStorageConfig,
  type TodosStorageEnv,
} from "./config.js";

export interface CreateTodosStorageAdapterOptions {
  config?: TodosStorageConfig;
  env?: TodosStorageEnv;
  sqlite?: CreateLocalSqliteTodosStorageAdapterOptions;
  postgresAdapter?: TodosStorageAdapter;
  postgresClient?: TodosPostgresQueryClient;
  sourceMachineId?: string;
}

/**
 * Select exactly one customer-owned server backend. This factory is never used
 * for cloud mode; cloud data is reachable only through the platform HTTP client.
 */
export function createTodosStorageAdapter(options: CreateTodosStorageAdapterOptions = {}): TodosStorageAdapter {
  const config = options.config ?? loadTodosStorageConfig(options.env);
  if (config.backend === "sqlite") {
    return createLocalSqliteTodosStorageAdapter(options.sqlite);
  }

  const adapter = options.postgresAdapter ?? (options.postgresClient
    ? createPostgresTodosStorageAdapter({
        client: options.postgresClient,
        ...(options.sourceMachineId ? { sourceMachineId: options.sourceMachineId } : {}),
      })
    : null);
  if (!adapter) {
    throw new Error("postgres customer-server storage requires an injected Postgres query client");
  }
  if (!adapter.capabilities.remotePersistence || adapter.capabilities.localPersistence) {
    throw new Error("TODOS_AUTHORITY_MISMATCH: postgres backend adapter must own exactly one persistent authority");
  }
  return adapter;
}
