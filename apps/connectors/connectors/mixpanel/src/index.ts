// Mixpanel Connector
// TypeScript wrapper for Mixpanel Track, Engage, Export, Insights, Funnels, and Retention APIs

export { Mixpanel } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { MixpanelClient, TrackApi, EngageApi, ExportApi, InsightsApi, FunnelsApi, RetentionApi } from './api';

// Export config utilities
export {
  getProjectToken,
  setProjectToken,
  getApiSecret,
  setApiSecret,
  getServiceAccountUsername,
  setServiceAccountUsername,
  getServiceAccountSecret,
  setServiceAccountSecret,
  getProjectId,
  setProjectId,
  getRegion,
  setRegion,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
