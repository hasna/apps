// Netlify Connector API
// A TypeScript wrapper for Netlify's REST API

export { Netlify } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { NetlifyClient } from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
