// Sprout Social Connector
// Social media management, publishing, and analytics via the Sprout Social API.

export { SproutSocial, SproutSocialClient } from './api';
export * from './types';

// Export config utilities
export {
  getAccessToken,
  setAccessToken,
  getCustomerId,
  setCustomerId,
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
