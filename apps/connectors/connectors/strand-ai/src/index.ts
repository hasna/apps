// Strand AI Connector
// TypeScript wrapper for the Strand AI Platform API

export { StrandAI, StrandClient, DEFAULT_BASE_URL } from './api';
export * from './types';

export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
