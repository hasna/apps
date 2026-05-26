// Resemble AI Connector
// TypeScript wrapper for Resemble AI voice cloning and TTS API

export { Resemble } from './api';
export * from './types';
export { ResembleClient } from './api';

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
