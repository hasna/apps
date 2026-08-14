// Stripe Apps API
// TypeScript client for the Stripe Apps REST API.

export { StripeApps } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  StripeAppsClient,
  ItemsApi,
  EventsApi,
  SearchApi,
  DEFAULT_BASE_URL,
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
