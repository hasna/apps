// Vapi Connector
// TypeScript wrapper for the Vapi voice AI API

export { Vapi } from './api';
export * from './types';
export { VapiClient, DEFAULT_BASE_URL } from './api';

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
} from './utils/config';
