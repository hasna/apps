// Ideogram AI Connector
// TypeScript wrapper for Ideogram AI image generation API

export { Ideogram } from './api';
export * from './types';
export { IdeogramClient } from './api';

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
