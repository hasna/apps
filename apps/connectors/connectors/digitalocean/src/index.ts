// DigitalOcean Connector API
// A TypeScript wrapper for DigitalOcean's REST API

export { DigitalOcean } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { DigitalOceanClient } from './api';

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
