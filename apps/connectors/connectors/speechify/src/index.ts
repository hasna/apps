// Speechify Connector
// TypeScript wrapper for Speechify text-to-speech API

export { Speechify } from './api';
export * from './types';
export { SpeechifyClient } from './api';

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
