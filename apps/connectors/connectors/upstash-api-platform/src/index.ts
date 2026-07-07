export { UpstashApiPlatform, UpstashApiPlatformClient } from './api';
export * from './types';

export {
  getEmail,
  setEmail,
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
  isConfigured,
  getConfigDir,
} from './utils/config';
