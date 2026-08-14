// Suno AI Connector
// TypeScript wrapper for Suno AI music generation API

export { Suno } from './api';
export * from './types';
export { SunoClient } from './api';

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
