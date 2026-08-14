// Userlens Connector
// TypeScript wrapper for Userlens customer success analytics APIs

export { Userlens, UserlensClient } from './api';
export * from './types';

export {
  getApiKey,
  setApiKey,
  getEventsBaseUrl,
  setEventsBaseUrl,
  getRawBaseUrl,
  setRawBaseUrl,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
} from './utils/config';
