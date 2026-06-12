// Types
export * from "./types/index.js";

// Database
export { getDb, closeDb, getDbForTesting } from "./db/database.js";
export {
  SEARCH_STORAGE_ENV,
  SEARCH_STORAGE_FALLBACK_ENV,
  SEARCH_STORAGE_MODE_ENV,
  SEARCH_STORAGE_MODE_FALLBACK_ENV,
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  getStorageConfig,
  getStorageConnectionString,
  getStorageDatabaseEnv,
  getStorageDatabaseEnvName,
  getStorageDatabaseUrl,
  type StorageEnv,
  type StorageConfig,
  type StorageMode,
} from "./db/storage-config.js";
export { PgAdapterAsync } from "./db/remote-storage.js";
export { applyPgMigrations } from "./db/pg-migrate.js";
export {
  STORAGE_TABLES,
  getStoragePg,
  getStorageStatus,
  parseStorageTables,
  pullStorageChanges,
  pushStorageChanges,
  runStorageMigrations,
  syncStorageChanges,
} from "./db/storage-sync.js";
export type { StorageStatus, SyncResult } from "./db/storage-sync.js";
export { createSearch, getSearch, listSearches, deleteSearch, updateSearchResults, getSearchStats } from "./db/searches.js";
export { createResult, createResults, getResult, listResults, searchResultsFts } from "./db/results.js";
export { createSavedSearch, getSavedSearch, listSavedSearches, deleteSavedSearch, updateSavedSearchLastRun } from "./db/saved-searches.js";
export { getProvider, listProviders, enableProvider, disableProvider, updateProvider, updateProviderLastUsed, isProviderConfigured } from "./db/providers.js";
export { getProfile, getProfileByName, listProfiles, createProfile, deleteProfile } from "./db/profiles.js";

// Config
export { getConfig, setConfig, resetConfig, getConfigValue, setConfigValue } from "./lib/config.js";

// Search engine
export { unifiedSearch, searchSingleProvider } from "./lib/search.js";
export { exportResults } from "./lib/export.js";

// Local file index
export { getIndexDb, closeIndexDb, getIndexDbPath, getIndexDbForTesting } from "./db/index-db.js";
export {
  addRoot,
  getRoot,
  listRoots,
  removeRoot,
  indexRoot,
  indexAllRoots,
  hasReadyRoot,
  refreshStaleRoots,
  autoRefreshStaleRoots,
  normalizeRootPath,
  type IndexRoot,
  type IndexStats,
} from "./lib/local/indexer.js";
export {
  searchFilePaths,
  searchFileContent,
  type FileHit,
  type ContentHit,
  type LineMatch,
  type LocalQueryOptions,
} from "./lib/local/query.js";
export {
  findLocal,
  type FindKind,
  type FindMatch,
  type FindOptions,
  type FindResponse,
} from "./lib/local/find.js";
