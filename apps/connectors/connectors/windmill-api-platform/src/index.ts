// Windmill Api Platform Connector
// TypeScript wrapper for the Windmill Api Platform REST API

export { WindmillApiPlatform } from './api';
export * from './types';
export { WindmillApiPlatformClient, DEFAULT_BASE_URL } from './api';

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
