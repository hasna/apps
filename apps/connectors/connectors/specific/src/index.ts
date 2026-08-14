// Specific API Connector
// A TypeScript wrapper for the Specific public GraphQL API

export { Specific } from './api';
export * from './types';

// Re-export the low-level client for advanced usage
export { SpecificClient } from './api';

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
