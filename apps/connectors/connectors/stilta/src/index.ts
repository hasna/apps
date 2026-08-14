// Stilta Connector
// Patent search, research jobs, and prior-art analysis

export { Stilta, StiltaClient } from './api';
export { DEFAULT_BASE_URL } from './api/client';
export * from './types';

// Export config utilities
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
  getConfigDir,
  getActiveProfileName,
} from './utils/config';
