// Trigger.dev Connector API
// A TypeScript wrapper for Trigger.dev's REST API

export { TriggerDev } from './api';
export * from './types';

export { TriggerDevClient } from './api';

export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  DEFAULT_BASE_URL,
} from './utils/config';
