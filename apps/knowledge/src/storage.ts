export {
  KNOWLEDGE_STORAGE_ENV,
  KNOWLEDGE_STORAGE_FALLBACK_ENV,
  KNOWLEDGE_STORAGE_MODE_ENV,
  KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV,
  KNOWLEDGE_STORAGE_TABLES,
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  STORAGE_TABLES,
  getStorageDatabaseEnv,
  getStorageDatabaseEnvName,
  getStorageDatabaseUrl,
  getStorageMode,
  getStoragePg,
  getStorageStatus,
  getSyncMetaAll,
  parseStorageTables,
  resolveTables,
  runStorageMigrations,
  storagePull,
  storagePush,
  storageSync,
} from './db/storage-sync.js';
export type {
  StorageEnv,
  StorageMode,
  StorageStatus,
  StorageStatusOptions,
  StorageSyncOptions,
  StorageRemoteAdapter,
  SyncMeta,
  SyncResult,
} from './db/storage-sync.js';
export { PgAdapterAsync, createKnowledgeCloudClient, KNOWLEDGE_APP_NAME } from './db/remote-storage.js';
export { PG_MIGRATIONS } from './db/pg-migrations.js';

// Vendored @hasna/contracts storage kit — the sanctioned cloud-mode pg access
// layer (PURE REMOTE per Amendment A1). Re-exported so downstream consumers get
// the canonical TLS/pool/query/migration surface from one place.
export {
  KIT_VERSION,
  createPgPool,
  createCloudPoolFromEnv,
  createQueryClient,
  wrapExecutor,
  resolveStorageMode,
  resolveDatabaseUrl,
  resolveTlsConfig,
  normalizeStorageMode as normalizeCloudStorageMode,
  storageEnvKeys,
  MigrationLedger,
  createMigrationLedger,
  defineMigration,
  checksumSql,
  checkHealth,
  checkReady,
} from './generated/storage-kit/index.js';
export type {
  PoolQueryClient,
  TypedQueryClient,
  PgExecutor,
  CreatePgPoolOptions,
  CreateCloudPoolFromEnvOptions,
  CloudPoolFromEnv,
  Migration,
  MigrationResult,
  StorageModeResolution,
} from './generated/storage-kit/index.js';
