// DeepSeek Connector
// TypeScript wrapper for DeepSeek AI API

export { DeepSeek } from './api';
export * from './types';
export { DeepSeekClient } from './api';

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
