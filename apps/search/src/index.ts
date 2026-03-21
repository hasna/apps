// Types
export * from "./types/index.js";

// Database
export { getDb, closeDb, getDbForTesting } from "./db/database.js";
export { createSearch, getSearch, listSearches, deleteSearch, updateSearchResults, getSearchStats } from "./db/searches.js";
export { createResult, createResults, getResult, listResults, searchResultsFts } from "./db/results.js";
export { createSavedSearch, getSavedSearch, listSavedSearches, deleteSavedSearch, updateSavedSearchLastRun } from "./db/saved-searches.js";
export { getProvider, listProviders, enableProvider, disableProvider, updateProvider, updateProviderLastUsed, isProviderConfigured } from "./db/providers.js";
export { getProfile, getProfileByName, listProfiles, createProfile, deleteProfile } from "./db/profiles.js";

// Config
export { getConfig, setConfig, resetConfig, getConfigValue, setConfigValue } from "./lib/config.js";
