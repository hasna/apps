// Yesware Connector
// TypeScript wrapper for Yesware sales email tracking and sequences API

export { Yesware } from './api';
export * from './types';
export { YeswareClient } from './api';

export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
