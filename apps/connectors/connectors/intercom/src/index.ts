// Intercom Connector
// Manage contacts, conversations, companies, and customer engagement

export { Intercom, IntercomClient } from './api';
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
