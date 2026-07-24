// Windmill Connector
// TypeScript wrapper for the Windmill REST API

export { Windmill } from './api';
export * from './types';
export { WindmillClient, DEFAULT_BASE_URL } from './api';

export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getWorkspace,
  setWorkspace,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
