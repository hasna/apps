export {
  LOGS_STORAGE_ENV,
  LOGS_STORAGE_FALLBACK_ENV,
  LOGS_STORAGE_MODE_ENV,
  LOGS_STORAGE_MODE_FALLBACK_ENV,
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  LOGS_STORAGE_TABLES,
  STORAGE_TABLES,
  getStorageDatabaseEnv,
  getStorageDatabaseEnvName,
  getStorageDatabaseUrl,
  getStorageMode,
  getStoragePg,
  getStorageStatus,
  resolveTables,
  runStorageMigrations,
  storagePull,
  storagePush,
  storageSync,
} from "./lib/storage-sync.ts";
export type {
  StorageEnv,
  StorageMode,
  StorageStatus,
} from "./lib/storage-sync.ts";
export { LogsPostgresStorage, PgAdapterAsync } from "./lib/remote-storage.ts";
export { PG_MIGRATIONS } from "./db/pg-migrations.ts";

// Unified data-plane Store abstraction: LocalStore (SQLite) + ApiStore (HTTP
// /v1 + bearer key) behind one interface, resolved from the environment. Every
// CLI command and MCP tool routes log reads/writes through this.
export {
  ApiStore,
  isApiMode,
  LocalStore,
  LOGS_APP_SLUG,
  resolveStore,
  type Store,
  type StoreMode,
} from "./store/index.ts";
