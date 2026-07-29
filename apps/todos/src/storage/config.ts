export type TodosServerBackend = "sqlite" | "postgres";
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

export interface TodosStorageConfig {
  service: "todos";
  backend: TodosServerBackend;
  database?: TodosPostgresStorageConfig;
  objectStorage?: TodosS3StorageConfig;
}

/**
 * Local-server storage configuration. This is deliberately separate from the
 * public local|cloud authority mode: SQLite and customer-operated Postgres are
 * both local authorities.
 */
export const TODOS_STORAGE_ENV = {
  backend: "HASNA_TODOS_SERVER_BACKEND",
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
} as const;

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("TODOS_INVALID_INPUT: boolean configuration must be exactly true or false");
}

export function parseTodosServerBackend(value: string | undefined): TodosServerBackend {
  if (value === undefined) return "sqlite";
  if (value === "sqlite" || value === "postgres") return value;
  throw new Error(`${TODOS_STORAGE_ENV.backend} must be exactly sqlite or postgres`);
}

export function getTodosServerBackend(env: TodosStorageEnv = process.env): TodosServerBackend {
  return parseTodosServerBackend(env[TODOS_STORAGE_ENV.backend]);
}

export function getTodosStorageDatabaseUrl(env: TodosStorageEnv = process.env): string | undefined {
  return clean(env[TODOS_STORAGE_ENV.databaseUrl]);
}

export function loadTodosStorageConfig(env: TodosStorageEnv = process.env): TodosStorageConfig {
  const backend = getTodosServerBackend(env);
  const databaseUrl = getTodosStorageDatabaseUrl(env);
  if (backend === "postgres" && !databaseUrl) {
    throw new Error(`${TODOS_STORAGE_ENV.databaseUrl} is required for the postgres customer-server backend`);
  }
  if (backend === "sqlite" && databaseUrl) {
    throw new Error(
      `TODOS_AUTHORITY_MISMATCH: ${TODOS_STORAGE_ENV.databaseUrl} cannot be set while ${TODOS_STORAGE_ENV.backend}=sqlite`,
    );
  }

  const schema = clean(env[TODOS_STORAGE_ENV.databaseSchema]);
  const bucket = clean(env[TODOS_STORAGE_ENV.s3Bucket]);
  const prefix = clean(env[TODOS_STORAGE_ENV.s3Prefix]) ?? "todos/";
  const region = clean(env[TODOS_STORAGE_ENV.awsRegion]);
  const endpoint = clean(env[TODOS_STORAGE_ENV.s3Endpoint]);

  return {
    service: "todos",
    backend,
    ...(databaseUrl
      ? {
          database: {
            provider: "postgres" as const,
            url: databaseUrl,
            ssl: parseBoolean(env[TODOS_STORAGE_ENV.databaseSsl], true),
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
            forcePathStyle: parseBoolean(env[TODOS_STORAGE_ENV.s3ForcePathStyle], false),
          },
        }
      : {}),
  };
}

export function getTodosStorageEnvName(key: keyof typeof TODOS_STORAGE_ENV): string {
  return TODOS_STORAGE_ENV[key];
}
