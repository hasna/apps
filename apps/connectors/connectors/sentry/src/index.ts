// Sentry API Connector
// A TypeScript wrapper for Sentry API

export { Sentry } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { SentryClient, ExampleApi } from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getApiSecret,
  setApiSecret,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
