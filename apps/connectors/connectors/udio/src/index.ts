// Udio AI Connector
// TypeScript wrapper for Udio AI music generation API

export { Udio } from './api';
export * from './types';
export { UdioClient } from './api';

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
