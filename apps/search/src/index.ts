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
  getStorageConfigPath,
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
export { getProvider, listProviders, enableProvider, disableProvider, updateProvider, updateProviderLastUsed, isProviderConfigured, getProviderConfigurationStatus } from "./db/providers.js";
export type { ProviderConfigurationStatus, ProviderConfigurationSource } from "./db/providers.js";
export { getProfile, getProfileByName, listProfiles, createProfile, deleteProfile } from "./db/profiles.js";

// Config
export {
  getConfig,
  getConfigDir,
  getConfigPath,
  getConfigDiagnostics,
  setConfig,
  resetConfig,
  getConfigValue,
  setConfigValue,
} from "./lib/config.js";

// Search engine
export { unifiedSearch, searchSingleProvider } from "./lib/search.js";
export { EXA_API_KEY_ENV, getExaApiKey, getExaConfigurationStatus, requireExaApiKey } from "./lib/exa.js";
export {
  EXA_WEBSETS_BASE_URL,
  createWebset,
  createWebsetSearch,
  getWebset,
  isExaWebsetsConfigured,
  listWebsetItems,
  listWebsets,
  waitForWebsetIdle,
} from "./lib/websets.js";
export type {
  CreateWebsetInput,
  ExaWebsetsClientOptions,
  GetWebsetOptions,
  ListWebsetItemsOptions,
  ListWebsetsOptions,
  WaitForWebsetOptions,
  Webset,
  WebsetCriterionInput,
  WebsetEnrichmentInput,
  WebsetEntityInput,
  WebsetImportRef,
  WebsetItem,
  WebsetsPage,
  WebsetSearch,
  WebsetSearchInput,
  WebsetScopeRef,
  WebsetSourceRef,
  WebsetMetadata,
} from "./lib/websets.js";
export { clearRouterCache, routeSearchProviders, routeSearchProvidersHeuristic } from "./lib/router.js";
export {
  DEFAULT_ROUTER_EVAL_CASES,
  evaluateRouterHeuristic,
  type RouterEvalCase,
  type RouterEvalReport,
  type RouterEvalResult,
} from "./lib/router-eval.js";
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
  scheduleAutoRefreshStaleRoots,
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
export {
  benchmarkLocalSearch,
  type LocalBenchmarkOptions,
  type LocalBenchmarkReport,
  type LocalBenchmarkRow,
} from "./lib/local/benchmark.js";
