import {
  TODOS_STORAGE_ENV,
  assertTodosRemoteStorageConfig,
  getCanonicalTodosRdsConfig,
  getTodosStorageEnvName,
  isTodosRemoteStorageEnabled,
  loadTodosStorageConfig,
  postgresTodosSyncSchemaSql,
} from "../storage/index.js";
import type { CanonicalTodosRdsConfig, TodosStorageConfig, TodosStorageEnv, TodosStorageMode } from "../storage/index.js";

export interface NativeStorageEnvStatus {
  name: string;
  active_name: string;
  configured: boolean;
}

export interface NativeStorageStatus {
  ok: boolean;
  service: "todos";
  mode: TodosStorageMode;
  local_default: boolean;
  remote_enabled: boolean;
  database: {
    configured: boolean;
    provider: "postgres" | null;
    redacted_url: string | null;
    ssl: boolean | null;
    schema: string | null;
  };
  object_storage: {
    configured: boolean;
    provider: "s3" | null;
    bucket: string | null;
    prefix: string | null;
    region: string | null;
    endpoint_configured: boolean;
    force_path_style: boolean;
  };
  sync: {
    batch_size: number;
    dry_run: boolean;
  };
  env: Record<keyof typeof TODOS_STORAGE_ENV, NativeStorageEnvStatus>;
  canonical: CanonicalTodosRdsConfig;
  issues: string[];
  warnings: string[];
  no_network: true;
}

export interface NativeStorageSyncPlan {
  ok: boolean;
  service: "todos";
  dry_run: true;
  no_network: true;
  status: NativeStorageStatus;
  postgres: {
    required: boolean;
    configured: boolean;
    schema_sql: string[];
  };
  object_storage: {
    required: boolean;
    configured: boolean;
    bucket: string | null;
    prefix: string | null;
  };
  steps: string[];
}

export interface NativeStorageSyncPlanOptions {
  includeSchemaSql?: boolean;
}

export function getNativeStorageStatus(env: TodosStorageEnv = process.env): NativeStorageStatus {
  const issues: string[] = [];
  const warnings: string[] = [];
  let config: TodosStorageConfig;

  try {
    config = loadTodosStorageConfig(env);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
    config = fallbackConfig(env);
  }

  try {
    assertTodosRemoteStorageConfig(config);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  const remoteEnabled = isTodosRemoteStorageEnabled(config);
  const remoteFieldsConfigured = Boolean(config.database || config.objectStorage);
  if (!remoteEnabled && remoteFieldsConfigured) {
    warnings.push(`${TODOS_STORAGE_ENV.mode}=local ignores configured remote storage fields`);
  }
  if (remoteEnabled && !config.objectStorage) {
    warnings.push(`${TODOS_STORAGE_ENV.s3Bucket} is not configured, so artifact sync will stay local`);
  }

  return {
    ok: issues.length === 0,
    service: "todos",
    mode: config.mode,
    local_default: config.mode === "local",
    remote_enabled: remoteEnabled,
    database: {
      configured: Boolean(config.database),
      provider: config.database?.provider ?? null,
      redacted_url: redactDatabaseUrl(config.database?.url),
      ssl: config.database?.ssl ?? null,
      schema: config.database?.schema ?? null,
    },
    object_storage: {
      configured: Boolean(config.objectStorage),
      provider: config.objectStorage?.provider ?? null,
      bucket: config.objectStorage?.bucket ?? null,
      prefix: config.objectStorage?.prefix ?? null,
      region: config.objectStorage?.region ?? null,
      endpoint_configured: Boolean(config.objectStorage?.endpoint),
      force_path_style: config.objectStorage?.forcePathStyle ?? false,
    },
    sync: {
      batch_size: config.sync.batchSize,
      dry_run: config.sync.dryRun,
    },
    env: storageEnvStatus(env),
    canonical: getCanonicalTodosRdsConfig(),
    issues,
    warnings,
    no_network: true,
  };
}

export function getNativeStorageSyncPlan(
  env: TodosStorageEnv = process.env,
  options: NativeStorageSyncPlanOptions = {},
): NativeStorageSyncPlan {
  const status = getNativeStorageStatus(env);
  const steps = [
    "Read local SQLite snapshot",
    status.remote_enabled ? "Prepare Postgres sync table upserts" : "Skip remote database writes in local mode",
    status.object_storage.configured ? "Plan S3 artifact object writes" : "Keep artifact storage local",
    "Report planned changes without opening network connections",
  ];

  return {
    ok: status.ok,
    service: "todos",
    dry_run: true,
    no_network: true,
    status,
    postgres: {
      required: status.remote_enabled,
      configured: status.database.configured,
      schema_sql: options.includeSchemaSql ? postgresTodosSyncSchemaSql() : [],
    },
    object_storage: {
      required: status.remote_enabled,
      configured: status.object_storage.configured,
      bucket: status.object_storage.bucket,
      prefix: status.object_storage.prefix,
    },
    steps,
  };
}

export function redactDatabaseUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "(redacted)";
  }
}

function storageEnvStatus(env: TodosStorageEnv): Record<keyof typeof TODOS_STORAGE_ENV, NativeStorageEnvStatus> {
  return Object.fromEntries(
    Object.entries(TODOS_STORAGE_ENV).map(([key, name]) => [
      key,
      {
        name,
        active_name: getTodosStorageEnvName(env, key as keyof typeof TODOS_STORAGE_ENV),
        configured: Boolean(clean(env[getTodosStorageEnvName(env, key as keyof typeof TODOS_STORAGE_ENV)])),
      },
    ]),
  ) as Record<keyof typeof TODOS_STORAGE_ENV, NativeStorageEnvStatus>;
}

function fallbackConfig(env: TodosStorageEnv): TodosStorageConfig {
  const modeValue = clean(env[TODOS_STORAGE_ENV.mode]);
  const mode = modeValue === "remote" || modeValue === "hybrid" ? modeValue : "local";
  return {
    service: "todos",
    mode,
    sync: {
      batchSize: 500,
      dryRun: false,
    },
  };
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
