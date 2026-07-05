// Voltair Connector
// TypeScript wrapper for the Voltair AI project run API

export { Voltair, VoltairClient, encodePathSegment, DEFAULT_BASE_URL } from './api';
export * from './types';

export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
