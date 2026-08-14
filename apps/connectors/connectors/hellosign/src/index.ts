// HelloSign (Dropbox Sign) Connector
// TypeScript wrapper for HelloSign electronic signature API

export { HelloSign } from './api';
export * from './types';
export { HelloSignClient } from './api';

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
} from './utils/config';
