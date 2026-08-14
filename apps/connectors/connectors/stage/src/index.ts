// Stage Connector
// TypeScript wrapper for the Stage code-review API

export { Stage } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { StageClient, ReviewsApi, PullRequestsApi } from './api';

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
