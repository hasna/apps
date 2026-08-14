// UniOne Connector
// Transactional email API for sending, templates, webhooks, and projects

export { UniOne, UniOneClient } from './api';
export * from './types';

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
  getConfigDir,
  getActiveProfileName,
} from './utils/config';
