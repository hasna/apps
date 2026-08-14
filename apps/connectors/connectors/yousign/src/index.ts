// Yousign connector — electronic signature API v3

export { Yousign } from './api';
export * from './types';
export { YousignClient } from './api';

export {
  getApiKey,
  setApiKey,
  getEnvironment,
  setEnvironment,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
