// PatentsView Connector
// A TypeScript wrapper for the USPTO PatentsView API

export { PatentsView } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { PatentsViewClient, PatentsApi, AssigneesApi, InventorsApi, CPCApi, LocationsApi } from './api';

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
