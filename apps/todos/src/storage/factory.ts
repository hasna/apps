import type { TodosStorageAdapter } from "./interfaces.js";
import type { CreateHybridTodosStorageAdapterOptions } from "./hybrid.js";
import type { PostgresTodosSyncStore, TodosPostgresQueryClient } from "./postgres-sync.js";
import type { CreateShadowTodosStorageAdapterOptions } from "./shadow.js";
import {
  loadTodosStorageConfig,
  assertTodosLocalStorageRole,
  resolveTodosStorageRole,
  TodosHostedStorageUnavailableError,
  type TodosStorageConfig,
  type TodosStorageEnv,
} from "./config.js";
import { resolveTodosPublicRuntimeOwnerModulePath } from "./runtime-module-path.js";

type CreateLocalSqliteTodosStorageAdapterOptions =
  import("./local-sqlite.js").CreateLocalSqliteTodosStorageAdapterOptions;

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

function readFactoryOption(
  options: CreateTodosStorageAdapterOptions,
  key: keyof CreateTodosStorageAdapterOptions,
): unknown {
  try {
    return Reflect.get(options, key);
  } catch {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
}

export function createTodosStorageAdapter(options: CreateTodosStorageAdapterOptions = {}): TodosStorageAdapter {
  // The actual process role is authoritative and precedes every caller getter.
  assertTodosLocalStorageRole(process.env);
  const envValue = readFactoryOption(options, "env");
  if (envValue !== undefined && (envValue === null || typeof envValue !== "object")) {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
  const env = envValue as TodosStorageEnv | undefined;
  if (env) {
    const role = resolveTodosStorageRole(env);
    if (role.role !== "local") throw new TodosHostedStorageUnavailableError(role.reason);
  }

  const configValue = readFactoryOption(options, "config");
  if (configValue !== undefined && (configValue === null || typeof configValue !== "object")) {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
  const config = (configValue as TodosStorageConfig | undefined) ?? loadTodosStorageConfig(env);
  let mode: unknown;
  try {
    mode = Reflect.get(config, "mode");
  } catch {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
  if (mode !== "local") throw new TodosHostedStorageUnavailableError("explicit_hosted");
  const localValue = readFactoryOption(options, "local");
  if (localValue !== undefined && (localValue === null || typeof localValue !== "object")) {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
  // Stage A preserves only the local adapter. Direct low-level constructors are
  // explicit operator APIs; this convenience factory never elects or builds a
  // remote, hybrid, or shadow client while authority is unavailable.
  const ownerPath = resolveTodosPublicRuntimeOwnerModulePath(import.meta.url);
  const owner = require(ownerPath) as typeof import("../stage-a-public-runtime.js");
  return owner.localSqlite.createLocalSqliteTodosStorageAdapter(
    localValue as CreateLocalSqliteTodosStorageAdapterOptions | undefined,
  );
}
