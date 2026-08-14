// Hedra API Connector
// A TypeScript wrapper for the Hedra AI video generation API

export { Hedra } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { HedraClient, CharactersApi, VoicesApi, ProjectsApi } from './api';

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
