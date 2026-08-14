// Kling AI Connector
// TypeScript wrapper for Kling AI video generation API

export { Kling } from './api';
export * from './types';
export { KlingClient } from './api';

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
