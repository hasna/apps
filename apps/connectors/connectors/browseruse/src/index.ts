// Browser Use Connector
// TypeScript wrapper for the Browser Use Cloud API

export { BrowserUse } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  BrowserUseClient,
  TasksApi,
  SessionsApi,
  ProfilesApi,
  BrowsersApi,
  SkillsApi,
  MarketplaceApi,
  FilesApi,
  BillingApi,
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
  hasApiKey,
} from './utils/config';
