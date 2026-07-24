// Synthetic Sciences API Connector
// A TypeScript wrapper for the Synthetic Sciences co-scientist API

export { SyntheticSciences, Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { SyntheticSciencesClient, ResearchApi } from './api';

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
