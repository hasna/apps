// Tidio Connector
// Live chat support, contacts, conversations, and operators

export { Tidio, TidioClient } from './api';
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
