import { parsePositiveSafeIntegerOr } from "../lib/positive-safe-integer.js";
import {
  TodosHostedStorageUnavailableError,
  unreadableStageAInput,
} from "./authority-floor.js";

export { TodosHostedStorageUnavailableError } from "./authority-floor.js";

export type TodosStorageMode = "local" | "remote" | "hybrid";

export type TodosStorageEnv = Record<string, string | undefined>;

const MAX_SNAPSHOTTED_ENV_KEYS = 4_096;
const MAX_SNAPSHOTTED_ENV_BYTES = 1024 * 1024;
const NATIVE_PROCESS_ENVIRONMENT = process.env;

/** Read one caller option without invoking accessors or inherited behavior. */
export function readStageADataProperty(
  value: object,
  key: PropertyKey,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  } catch {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
  if (!descriptor) return undefined;
  if (!("value" in descriptor) || descriptor.get || descriptor.set) {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
  return descriptor.value;
}

/**
 * Take a bounded, immutable environment snapshot without invoking getters.
 * Listener code retains this object rather than caller- or process-mutable env.
 */
export function snapshotTodosStorageEnvironment(value: unknown): NodeJS.ProcessEnv {
  if (value === null || typeof value !== "object") {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
  let keys: ArrayLike<string | symbol>;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
  if (keys.length > MAX_SNAPSHOTTED_ENV_KEYS) {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
  const snapshot = Object.create(null) as NodeJS.ProcessEnv;
  const nativeProcessEnvironment = value === NATIVE_PROCESS_ENVIRONMENT;
  let bytes = 0;
  for (const key of Array.from(keys)) {
    if (typeof key !== "string") {
      throw new TodosHostedStorageUnavailableError("unreadable_options");
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor) throw new TodosHostedStorageUnavailableError("unreadable_options");
    const entry = "value" in descriptor
      ? descriptor.value
      : nativeProcessEnvironment
        ? Reflect.get(value, key)
        : (() => { throw new TodosHostedStorageUnavailableError("unreadable_options"); })();
    if (entry !== undefined && typeof entry !== "string") {
      throw new TodosHostedStorageUnavailableError("unreadable_options");
    }
    bytes += Buffer.byteLength(key) + (entry === undefined ? 0 : Buffer.byteLength(entry));
    if (bytes > MAX_SNAPSHOTTED_ENV_BYTES) {
      throw new TodosHostedStorageUnavailableError("unreadable_options");
    }
    Object.defineProperty(snapshot, key, {
      value: entry,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

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

export interface TodosStorageConfigDiagnostics {
  config: TodosStorageConfig;
  /** Ordered field-level parse failures; successfully parsed fields are kept. */
  issues: Error[];
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

/**
 * Process role used by every Stage-A datastore entrypoint.
 *
 * `invalid` is deliberately distinct from `hosted`: a legacy service DSN or
 * conflicting/unknown mode never elects a server role, but it still fails
 * closed instead of falling through to SQLite.
 */
export type TodosStorageRole = "local" | "hosted" | "invalid";

export interface TodosStorageRoleResolution {
  role: TodosStorageRole;
  mode: TodosStorageMode | null;
  source: string;
  reason: "default_local" | "explicit_local" | "explicit_hosted" | "ambiguous_service_dsn" | "invalid_mode" | "conflicting_modes";
}

/** Canonical normalization used by role resolution, status, sync planning, and config. */
export function normalizeTodosStorageMode(value: string | undefined): TodosStorageMode | null {
  if (typeof value !== "string") return null;
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === "local") return "local";
  if (normalized === "hybrid") return "hybrid";
  if (["remote", "cloud", "self_hosted", "self-hosted"].includes(normalized)) return "remote";
  return null;
}

/**
 * Resolve one explicit server/storage role without consulting credentials.
 * Generic `DATABASE_URL` is intentionally unrelated to Todos. A Todos-specific
 * DSN without a mode is ambiguous legacy configuration: it fails closed but
 * does not silently select hosted mode.
 */
export function resolveTodosStorageRole(env: TodosStorageEnv = process.env): TodosStorageRoleResolution {
  const primaryRaw = clean(readEnvironmentString(env, TODOS_STORAGE_ENV.mode));
  const fallbackRaw = clean(readEnvironmentString(env, TODOS_STORAGE_FALLBACK_ENV.mode));
  const primaryMode = primaryRaw ? normalizeTodosStorageMode(primaryRaw) : undefined;
  const fallbackMode = fallbackRaw ? normalizeTodosStorageMode(fallbackRaw) : undefined;

  if ((primaryRaw && !primaryMode) || (fallbackRaw && !fallbackMode)) {
    return {
      role: "invalid",
      mode: null,
      source: primaryRaw && !primaryMode ? TODOS_STORAGE_ENV.mode : TODOS_STORAGE_FALLBACK_ENV.mode,
      reason: "invalid_mode",
    };
  }
  if (primaryMode && fallbackMode && primaryMode !== fallbackMode) {
    return {
      role: "invalid",
      mode: null,
      source: `${TODOS_STORAGE_ENV.mode}+${TODOS_STORAGE_FALLBACK_ENV.mode}`,
      reason: "conflicting_modes",
    };
  }

  const mode = primaryMode ?? fallbackMode;
  if (mode) {
    return {
      role: mode === "local" ? "local" : "hosted",
      mode,
      source: primaryMode ? TODOS_STORAGE_ENV.mode : TODOS_STORAGE_FALLBACK_ENV.mode,
      reason: mode === "local" ? "explicit_local" : "explicit_hosted",
    };
  }

  const primaryDsn = clean(readEnvironmentString(env, TODOS_STORAGE_ENV.databaseUrl));
  const fallbackDsn = clean(readEnvironmentString(env, TODOS_STORAGE_FALLBACK_ENV.databaseUrl));
  const serviceDsn = primaryDsn ?? fallbackDsn;
  if (serviceDsn) {
    return {
      role: "invalid",
      mode: null,
      source: primaryDsn ? TODOS_STORAGE_ENV.databaseUrl : TODOS_STORAGE_FALLBACK_ENV.databaseUrl,
      reason: "ambiguous_service_dsn",
    };
  }

  return { role: "local", mode: "local", source: "default", reason: "default_local" };
}

/** Refuse any process whose canonical role is not explicitly safe for SQLite. */
export function assertTodosLocalStorageRole(env: TodosStorageEnv = process.env): TodosStorageRoleResolution {
  const resolution = resolveTodosStorageRole(env);
  if (resolution.role !== "local") throw new TodosHostedStorageUnavailableError(resolution.reason);
  return resolution;
}

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
  // A hosted/invalid real process may not inspect a caller-controlled env
  // object in an attempt to manufacture a local adapter.
  if (env !== process.env) {
    const processRole = resolveTodosStorageRole(process.env);
    if (processRole.role !== "local") {
      throw new TodosHostedStorageUnavailableError(processRole.reason);
    }
  }
  const result = inspectTodosStorageConfig(env);
  if (result.issues[0]) throw result.issues[0];
  return result.config;
}

/**
 * Parse storage configuration field-by-field for diagnostics. Unlike the
 * strict loader, one malformed field does not erase unrelated valid fields or
 * their selected primary/fallback aliases from status output.
 */
export function inspectTodosStorageConfig(env: TodosStorageEnv = process.env): TodosStorageConfigDiagnostics {
  const issues: Error[] = [];
  const resolution = resolveTodosStorageRole(env);
  const mode = captureConfigField(
    () => getTodosStorageMode(env),
    resolution.role === "local" ? "local" : resolution.mode ?? "remote",
    issues,
  );
  const databaseUrl = readStorageEnv(env, "databaseUrl").value;
  const databaseSsl = readStorageEnv(env, "databaseSsl");
  const bucket = readStorageEnv(env, "s3Bucket").value;
  const prefix = readStorageEnv(env, "s3Prefix").value ?? "todos/";
  const region = readStorageEnv(env, "awsRegion").value;
  const endpoint = readStorageEnv(env, "s3Endpoint").value;
  const schema = readStorageEnv(env, "databaseSchema").value;
  const forcePathStyle = readStorageEnv(env, "s3ForcePathStyle");
  // Preserve the caller's exact spelling for canonical integer validation.
  // Other fields intentionally retain their historical whitespace trimming.
  const syncBatchSize = readRawStorageEnv(env, "syncBatchSize");
  const syncDryRun = readStorageEnv(env, "syncDryRun");

  const config: TodosStorageConfig = {
    service: "todos",
    mode,
    ...(databaseUrl
      ? {
          database: {
            provider: "postgres" as const,
            url: databaseUrl,
            ssl: captureConfigField(
              () => parseBoolean(databaseSsl.value, true, databaseSsl.name),
              true,
              issues,
            ),
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
            forcePathStyle: captureConfigField(
              () => parseBoolean(forcePathStyle.value, false, forcePathStyle.name),
              false,
              issues,
            ),
          },
        }
      : {}),
    sync: {
      batchSize: captureConfigField(
        () => parsePositiveInteger(syncBatchSize.value, 500, syncBatchSize.name),
        500,
        issues,
      ),
      dryRun: captureConfigField(
        () => parseBoolean(syncDryRun.value, false, syncDryRun.name),
        false,
        issues,
      ),
    },
  };
  return { config, issues };
}

export function loadStorageConfig(env: TodosStorageEnv = process.env): TodosStorageConfig {
  return loadTodosStorageConfig(env);
}

export function isTodosRemoteStorageEnabled(config: TodosStorageConfig): boolean {
  const processRole = resolveTodosStorageRole(process.env);
  if (processRole.role !== "local") {
    throw new TodosHostedStorageUnavailableError(processRole.reason);
  }
  let mode: unknown;
  try {
    mode = Reflect.get(config, "mode");
  } catch {
    return unreadableStageAInput("unreadable_options");
  }
  return mode === "remote" || mode === "hybrid";
}

export function assertTodosRemoteStorageConfig(config: TodosStorageConfig): void {
  if (!isTodosRemoteStorageEnabled(config)) return;
  let mode: unknown;
  let database: unknown;
  try {
    mode = Reflect.get(config, "mode");
    database = Reflect.get(config, "database");
  } catch {
    return unreadableStageAInput("unreadable_options");
  }
  let url: unknown;
  if (database && typeof database === "object") {
    try {
      url = Reflect.get(database, "url");
    } catch {
      return unreadableStageAInput("unreadable_options");
    }
  }
  if (typeof url !== "string" || url.length === 0) {
    throw new Error(`${TODOS_STORAGE_ENV.databaseUrl} is required when ${TODOS_STORAGE_ENV.mode}=${String(mode)}`);
  }
}

export function parseStorageMode(value: string | undefined): TodosStorageMode {
  const normalized = normalizeTodosStorageMode(value);
  if (normalized) return normalized;
  if (!clean(value)) return "local";
  throw new Error(
    `${TODOS_STORAGE_ENV.mode} must be local, remote, hybrid, cloud, self_hosted, or self-hosted`,
  );
}

export function getTodosStorageMode(env: TodosStorageEnv = process.env): TodosStorageMode {
  const resolution = resolveTodosStorageRole(env);
  if (resolution.role === "invalid" || resolution.mode === null) {
    throw new TodosHostedStorageUnavailableError(resolution.reason);
  }
  return resolution.mode;
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
  return parseStorageBoolean(env, "shadow", false);
}

export function getTodosStorageShadowEnvName(env: TodosStorageEnv = process.env): string {
  return readStorageEnv(env, "shadow").name;
}

export function assertTodosShadowConfig(config: TodosStorageConfig, env: TodosStorageEnv = process.env): void {
  const processRole = resolveTodosStorageRole(process.env);
  if (processRole.role !== "local") {
    throw new TodosHostedStorageUnavailableError(processRole.reason);
  }
  if (!isTodosShadowEnabled(env)) return;
  void config;
  throw new TodosHostedStorageUnavailableError("authority_resolver_unavailable");
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
  const primaryValue = clean(readEnvironmentString(env, primaryName));
  if (primaryValue !== undefined) return { name: primaryName, value: primaryValue };

  const fallbackName = TODOS_STORAGE_FALLBACK_ENV[key];
  const fallbackValue = clean(readEnvironmentString(env, fallbackName));
  if (fallbackValue !== undefined) return { name: fallbackName, value: fallbackValue };

  return { name: primaryName };
}

function readRawStorageEnv(
  env: TodosStorageEnv,
  key: keyof typeof TODOS_STORAGE_ENV,
): { name: string; value?: string } {
  const primaryName = TODOS_STORAGE_ENV[key];
  const primaryValue = readEnvironmentString(env, primaryName);
  if (clean(primaryValue) !== undefined) return { name: primaryName, value: primaryValue };

  const fallbackName = TODOS_STORAGE_FALLBACK_ENV[key];
  const fallbackValue = readEnvironmentString(env, fallbackName);
  if (clean(fallbackValue) !== undefined) return { name: fallbackName, value: fallbackValue };

  return { name: primaryName };
}

function clean(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseStorageBoolean(
  env: TodosStorageEnv,
  key: keyof typeof TODOS_STORAGE_ENV,
  fallback: boolean,
): boolean {
  const { name, value } = readStorageEnv(env, key);
  return parseBoolean(value, fallback, name);
}

function parseBoolean(value: string | undefined, fallback: boolean, envName: string): boolean {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${envName} must be a boolean (1/0, true/false, yes/no, or on/off)`);
}

function parsePositiveInteger(value: string | undefined, fallback: number, envName: string): number {
  return parsePositiveSafeIntegerOr(value, fallback, envName);
}

function readEnvironmentString(env: TodosStorageEnv, name: string): string | undefined {
  let value: unknown;
  try {
    value = Reflect.get(env, name);
  } catch {
    return unreadableStageAInput("unreadable_environment");
  }
  return typeof value === "string" ? value : undefined;
}

function captureConfigField<T>(read: () => T, fallback: T, issues: Error[]): T {
  try {
    return read();
  } catch (error) {
    issues.push(error instanceof Error ? error : new Error(String(error)));
    return fallback;
  }
}
