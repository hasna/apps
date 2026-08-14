// Icons8 Connector API
// A TypeScript wrapper for the Icons8 API

export { Icons8 } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { Icons8Client, IconsApi } from './api';

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
