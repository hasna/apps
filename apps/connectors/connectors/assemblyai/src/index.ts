// AssemblyAI Connector
// TypeScript wrapper for AssemblyAI speech-to-text API

export { AssemblyAI } from './api';
export * from './types';
export { AssemblyAIClient } from './api';

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
