// SparkPost Connector
// Transactional email delivery, templates, domains, and analytics

export { SparkPost, SparkPostClient } from './api';
export * from './types';

export {
  getApiKey,
  setApiKey,
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
  getConfigDir,
  getActiveProfileName,
} from './utils/config';
