// Fireworks AI Connector
// TypeScript wrapper for Fireworks AI API

export { Fireworks } from './api';
export * from './types';
export { FireworksClient } from './api';

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
