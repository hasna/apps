// Windmill API Platform Connector
// TypeScript wrapper for workspace-scoped Windmill REST APIs

export { WindmillApiPlatform } from './api';
export * from './types';
export { WindmillApiPlatformClient, DEFAULT_BASE_URL } from './api';

export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getWorkspace,
  setWorkspace,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
