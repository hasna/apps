// Sprinklr Connector
// Customer experience platform — cases, events, and search

export { Sprinklr, SprinklrClient } from './api';
export * from './types';

export {
  getApiKey,
  getBaseUrl,
  setApiKey,
  setBaseUrl,
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
