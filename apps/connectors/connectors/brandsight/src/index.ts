// Brandsight Connector API
// A TypeScript wrapper for the Brandsight REST API

export { Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ConnectorClient,
  MonitoringApi,
  IntelligenceApi,
} from './api';

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
