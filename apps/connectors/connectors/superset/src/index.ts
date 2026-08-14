// Apache Superset Connector
// TypeScript wrapper for the Apache Superset REST API with JWT authentication

export { Superset } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  SupersetClient,
  DashboardsApi,
  ChartsApi,
  DatasetsApi,
  DatabasesApi,
  SavedQueriesApi,
  QueriesApi,
} from './api';

// Rison helpers for building list queries
export { risonEncode, buildListQuery } from './utils/rison';

// Config utilities
export {
  normalizeBaseUrl,
  getBaseUrl,
  setBaseUrl,
  getUsername,
  setUsername,
  getPassword,
  setPassword,
  getProvider,
  setProvider,
  getAccessToken,
  setAccessToken,
  getRefreshToken,
  setRefreshToken,
  saveTokens,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
} from './utils/config';
