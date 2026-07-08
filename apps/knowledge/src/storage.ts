// Local, read-only knowledge.db storage status helpers. The client-side
// Postgres sync engine (getStoragePg / storagePush / storagePull / storageSync /
// runStorageMigrations) has been REMOVED: it was a forbidden DSN-on-client path
// that connected fleet machines straight to the shared RDS. Clients reach the
// shared store only through the HTTP ApiStore.
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
  getStorageStatus,
  getSyncMetaAll,
  parseStorageTables,
  resolveTables,
} from './db/storage-sync.js';
export type {
  StorageEnv,
  StorageMode,
  StorageStatus,
  StorageStatusOptions,
  StorageSyncOptions,
  SyncMeta,
  SyncResult,
} from './db/storage-sync.js';

// SERVER-SIDE cloud access (src/serve + scripts/apply-cloud-migrations). These
// require the RDS DSN, which is injected only inside our AWS and NEVER shipped
// to fleet machines. They are intentionally kept out of the CLI/MCP/SDK client
// command surface.
export { createKnowledgeCloudClient, KNOWLEDGE_APP_NAME } from './db/remote-storage.js';
export { PG_MIGRATIONS } from './db/pg-migrations.js';

// Vendored @hasna/contracts storage kit — the sanctioned cloud-mode pg access
// layer used by the server and the deploy migration script.
export {
  KIT_VERSION,
  resolveStorageMode,
  resolveDatabaseUrl,
  resolveTlsConfig,
  normalizeStorageMode as normalizeCloudStorageMode,
  storageEnvKeys,
  MigrationLedger,
  createMigrationLedger,
  defineMigration,
  checksumSql,
  wrapExecutor,
  checkHealth,
  checkReady,
} from './generated/storage-kit/index.js';
export type {
  PoolQueryClient,
  TypedQueryClient,
  PgExecutor,
  Migration,
  MigrationResult,
  StorageModeResolution,
} from './generated/storage-kit/index.js';
