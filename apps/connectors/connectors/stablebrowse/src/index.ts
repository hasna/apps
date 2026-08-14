// StableBrowse Connector
// TypeScript wrapper for the StableBrowse API

export { StableBrowse } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  StableBrowseClient,
  TasksApi,
  SessionsApi,
  EndUsersApi,
  DesignApi,
} from './api';

export type { StableBrowseClientConfig, RequestOptions } from './api';

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
  hasApiKey,
} from './utils/config';
