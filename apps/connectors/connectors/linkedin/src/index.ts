// LinkedIn Connector
// Manage profiles, posts, organizations, and analytics

export { LinkedIn, LinkedInClient } from './api';
export * from './types';

// Export config utilities
export {
  getAccessToken,
  setAccessToken,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
  getActiveProfileName,
} from './utils/config';
