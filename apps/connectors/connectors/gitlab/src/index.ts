// GitLab Connector API
// A TypeScript wrapper for GitLab's REST API

export { GitLab } from './api';
export * from './types';

// Re-export client for advanced usage
export { GitLabClient } from './api';

// Export config utilities
export {
  getAccessToken,
  setAccessToken,
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
