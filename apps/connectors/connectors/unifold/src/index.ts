// Unifold Connector
// TypeScript wrapper for the Unifold cross-chain deposit API

export { Unifold } from './api';
export * from './types';
export { UnifoldClient } from './api';

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
} from './utils/config';
