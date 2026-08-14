// Groq Connector
// TypeScript wrapper for Groq AI API

export { Groq } from './api';
export * from './types';
export { GroqClient } from './api';

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
