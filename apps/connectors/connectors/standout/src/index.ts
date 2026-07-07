// Standout Connector
export { Standout, StandoutClient, DEFAULT_BASE_URL } from './api';
export * from './types';

export {
  getApiKey,
  getBaseUrl,
  setApiKey,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
