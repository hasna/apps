// Syntropy Connector API
// A TypeScript wrapper for the Syntropy REST API

export { Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ConnectorClient,
  DEFAULT_BASE_URL,
  SpecsApi,
  BuildsApi,
  PullRequestsApi,
  TasksApi,
  RawApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
