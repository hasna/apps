// Travo AI Connector
// TypeScript wrapper for the Travo AI travel platform API

export { TravoAi } from './api';
export * from './types';
export { TravoAiClient } from './api';

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
