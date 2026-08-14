// Wise Connector
// TypeScript wrapper for Wise international money transfers API

export { Wise } from './api';
export * from './types';
export { WiseClient } from './api';

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
