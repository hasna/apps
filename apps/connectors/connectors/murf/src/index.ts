// Murf AI Connector
// TypeScript wrapper for Murf AI text-to-speech API

export { Murf } from './api';
export * from './types';
export { MurfClient } from './api';

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
