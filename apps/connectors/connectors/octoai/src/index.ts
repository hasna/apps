// OctoAI Connector
// TypeScript wrapper for OctoAI API

export { OctoAI } from './api';
export * from './types';
export { OctoAIClient } from './api';

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
