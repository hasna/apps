// Bloom (TryBloom) Connector
// TypeScript wrapper for the Bloom on-brand creative API

export { Trybloom } from './api';
export * from './types';
export { TrybloomClient, DEFAULT_BASE_URL, encodePathSegment } from './api';

export {
  getApiKey,
  getBaseUrl,
  setApiKey,
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
