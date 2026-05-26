// HeyGen API
// A TypeScript wrapper for the HeyGen AI video generation API

export { HeyGen } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { HeyGenClient, ExampleApi } from './api';

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
