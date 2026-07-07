export type TodosStorageMode = "local" | "remote" | "hybrid";

export type TodosStorageEnv = Record<string, string | undefined>;

export const TODOS_STORAGE_TABLES = [
  "todos_sync_records",
  "todos_sync_cursors",
] as const;

export const STORAGE_TABLES = TODOS_STORAGE_TABLES;

export type TodosStorageTable = typeof TODOS_STORAGE_TABLES[number];

export interface TodosPostgresStorageConfig {
  provider: "postgres";
  url: string;
  ssl: boolean;
  schema?: string;
}

export interface TodosS3StorageConfig {
  provider: "s3";
  bucket: string;
  prefix: string;
  region?: string;
  endpoint?: string;
  forcePathStyle: boolean;
}

export interface TodosSyncConfig {
  batchSize: number;
  dryRun: boolean;
}

export interface TodosStorageConfig {
  service: "todos";
  mode: TodosStorageMode;
  database?: TodosPostgresStorageConfig;
  objectStorage?: TodosS3StorageConfig;
  sync: TodosSyncConfig;
}

export const TODOS_STORAGE_ENV = {
  mode: "HASNA_TODOS_STORAGE_MODE",
  shadow: "HASNA_TODOS_SHADOW",
  databaseUrl: "HASNA_TODOS_DATABASE_URL",
  databaseSsl: "HASNA_TODOS_DATABASE_SSL",
  databaseSchema: "HASNA_TODOS_DATABASE_SCHEMA",
  s3Bucket: "HASNA_TODOS_S3_BUCKET",
  s3Prefix: "HASNA_TODOS_S3_PREFIX",
  awsRegion: "HASNA_TODOS_AWS_REGION",
  s3Endpoint: "HASNA_TODOS_S3_ENDPOINT",
  s3ForcePathStyle: "HASNA_TODOS_S3_FORCE_PATH_STYLE",
  s3AccessKeyId: "HASNA_TODOS_S3_ACCESS_KEY_ID",
  s3SecretAccessKey: "HASNA_TODOS_S3_SECRET_ACCESS_KEY",
  s3SessionToken: "HASNA_TODOS_S3_SESSION_TOKEN",
  syncBatchSize: "HASNA_TODOS_SYNC_BATCH_SIZE",
  syncDryRun: "HASNA_TODOS_SYNC_DRY_RUN",
} as const;

export const TODOS_STORAGE_FALLBACK_ENV = {
  mode: "TODOS_STORAGE_MODE",
  shadow: "TODOS_SHADOW",
  databaseUrl: "TODOS_DATABASE_URL",
  databaseSsl: "TODOS_DATABASE_SSL",
  databaseSchema: "TODOS_DATABASE_SCHEMA",
  s3Bucket: "TODOS_S3_BUCKET",
  s3Prefix: "TODOS_S3_PREFIX",
  awsRegion: "TODOS_AWS_REGION",
  s3Endpoint: "TODOS_S3_ENDPOINT",
  s3ForcePathStyle: "TODOS_S3_FORCE_PATH_STYLE",
  s3AccessKeyId: "TODOS_S3_ACCESS_KEY_ID",
  s3SecretAccessKey: "TODOS_S3_SECRET_ACCESS_KEY",
  s3SessionToken: "TODOS_S3_SESSION_TOKEN",
  syncBatchSize: "TODOS_SYNC_BATCH_SIZE",
  syncDryRun: "TODOS_SYNC_DRY_RUN",
} as const;

export const CANONICAL_TODOS_RDS_CLUSTER = "hasna-xyz-infra-apps-prod-postgres";
export const CANONICAL_TODOS_RDS_DATABASE = "todos";
export const CANONICAL_TODOS_RDS_RUNTIME_PATH = "hasna/xyz/opensource/todos/prod/rds";

export interface CanonicalTodosRdsConfig {
  cluster: typeof CANONICAL_TODOS_RDS_CLUSTER;
  database: typeof CANONICAL_TODOS_RDS_DATABASE;
  runtimeSecretPath: typeof CANONICAL_TODOS_RDS_RUNTIME_PATH;
  primaryEnv: typeof TODOS_STORAGE_ENV.databaseUrl;
  fallbackEnv: typeof TODOS_STORAGE_FALLBACK_ENV.databaseUrl;
}

export function getCanonicalTodosRdsConfig(): CanonicalTodosRdsConfig {
  return {
    cluster: CANONICAL_TODOS_RDS_CLUSTER,
    database: CANONICAL_TODOS_RDS_DATABASE,
    runtimeSecretPath: CANONICAL_TODOS_RDS_RUNTIME_PATH,
    primaryEnv: TODOS_STORAGE_ENV.databaseUrl,
    fallbackEnv: TODOS_STORAGE_FALLBACK_ENV.databaseUrl,
  };
}

export function loadTodosStorageConfig(env: TodosStorageEnv = process.env): TodosStorageConfig {
  const mode = getTodosStorageMode(env);
  const databaseUrl = getTodosStorageDatabaseUrl(env);
  const bucket = readStorageEnv(env, "s3Bucket").value;
  const prefix = readStorageEnv(env, "s3Prefix").value ?? "todos/";
  const region = readStorageEnv(env, "awsRegion").value;
  const endpoint = readStorageEnv(env, "s3Endpoint").value;
  const schema = readStorageEnv(env, "databaseSchema").value;

  return {
    service: "todos",
    mode,
    ...(databaseUrl
      ? {
          database: {
            provider: "postgres" as const,
            url: databaseUrl,
            ssl: parseBoolean(readStorageEnv(env, "databaseSsl").value, true),
            ...(schema ? { schema } : {}),
          },
        }
      : {}),
    ...(bucket
      ? {
          objectStorage: {
            provider: "s3" as const,
            bucket,
            prefix,
            ...(region ? { region } : {}),
            ...(endpoint ? { endpoint } : {}),
            forcePathStyle: parseBoolean(readStorageEnv(env, "s3ForcePathStyle").value, false),
          },
        }
      : {}),
    sync: {
      batchSize: parsePositiveInteger(readStorageEnv(env, "syncBatchSize").value, 500),
      dryRun: parseBoolean(readStorageEnv(env, "syncDryRun").value, false),
    },
  };
}

export function loadStorageConfig(env: TodosStorageEnv = process.env): TodosStorageConfig {
  return loadTodosStorageConfig(env);
}

export function isTodosRemoteStorageEnabled(config: TodosStorageConfig): boolean {
  return config.mode === "remote" || config.mode === "hybrid";
}

export function assertTodosRemoteStorageConfig(config: TodosStorageConfig): void {
  if (!isTodosRemoteStorageEnabled(config)) return;
  if (!config.database?.url) {
    throw new Error(`${TODOS_STORAGE_ENV.databaseUrl} is required when ${TODOS_STORAGE_ENV.mode}=${config.mode}`);
  }
}

export function parseStorageMode(value: string | undefined): TodosStorageMode {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return "local";
  if (normalized === "local" || normalized === "remote" || normalized === "hybrid") return normalized;
  throw new Error(`${TODOS_STORAGE_ENV.mode} must be local, remote, or hybrid`);
}

export function getTodosStorageMode(env: TodosStorageEnv = process.env): TodosStorageMode {
  return parseStorageMode(readStorageEnv(env, "mode").value);
}

export function getStorageMode(env: TodosStorageEnv = process.env): TodosStorageMode {
  return getTodosStorageMode(env);
}

/**
 * Dual-write shadow mode. When enabled, local SQLite stays the sole source of
 * truth for reads AND writes; every successful local write is asynchronously
 * mirrored to the remote Postgres sync tables (fire-and-forget with retries).
 * NOTHING is ever read from the remote store while shadow mode is active — it
 * is a pure pre-cutover mirror for validating divergence, per Amendment A1.
 */
export function isTodosShadowEnabled(env: TodosStorageEnv = process.env): boolean {
  return parseBoolean(readStorageEnv(env, "shadow").value, false);
}

export function getTodosStorageShadowEnvName(env: TodosStorageEnv = process.env): string {
  return readStorageEnv(env, "shadow").name;
}

export function assertTodosShadowConfig(config: TodosStorageConfig, env: TodosStorageEnv = process.env): void {
  if (!isTodosShadowEnabled(env)) return;
  if (config.mode !== "local") {
    throw new Error(
      `${readStorageEnv(env, "shadow").name} shadow mirror requires ${TODOS_STORAGE_ENV.mode}=local (got ${config.mode})`,
    );
  }
  if (!config.database?.url) {
    throw new Error(
      `${TODOS_STORAGE_ENV.databaseUrl} is required when ${readStorageEnv(env, "shadow").name} is enabled`,
    );
  }
}

export function getTodosStorageDatabaseEnv(env: TodosStorageEnv = process.env): string {
  return readStorageEnv(env, "databaseUrl").name;
}

export function getStorageDatabaseEnv(env: TodosStorageEnv = process.env): string {
  return getTodosStorageDatabaseEnv(env);
}

export function getTodosStorageDatabaseUrl(env: TodosStorageEnv = process.env): string | undefined {
  return readStorageEnv(env, "databaseUrl").value;
}

export function getStorageDatabaseUrl(env: TodosStorageEnv = process.env): string | undefined {
  return getTodosStorageDatabaseUrl(env);
}

export function getTodosStorageEnvName(
  env: TodosStorageEnv,
  key: keyof typeof TODOS_STORAGE_ENV,
): string {
  return readStorageEnv(env, key).name;
}

function readStorageEnv(
  env: TodosStorageEnv,
  key: keyof typeof TODOS_STORAGE_ENV,
): { name: string; value?: string } {
  const primaryName = TODOS_STORAGE_ENV[key];
  const primaryValue = clean(env[primaryName]);
  if (primaryValue !== undefined) return { name: primaryName, value: primaryValue };

  const fallbackName = TODOS_STORAGE_FALLBACK_ENV[key];
  const fallbackValue = clean(env[fallbackName]);
  if (fallbackValue !== undefined) return { name: fallbackName, value: fallbackValue };

  return { name: primaryName };
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Expected boolean env value, got ${value}`);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const normalized = clean(value);
  if (!normalized) return fallback;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${TODOS_STORAGE_ENV.syncBatchSize} must be a positive integer`);
  }
  return parsed;
}
