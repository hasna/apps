// Cohere Connector
// TypeScript wrapper for Cohere AI API

export { Cohere } from './api';
export * from './types';
export { CohereClient } from './api';

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
