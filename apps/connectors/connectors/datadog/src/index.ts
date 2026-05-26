// Datadog Connector API
// A TypeScript wrapper for Datadog's REST API

export { Datadog } from './api';
export * from './types';

// Re-export client for advanced usage
export { DatadogClient } from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getAppKey,
  setAppKey,
  getSite,
  setSite,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
