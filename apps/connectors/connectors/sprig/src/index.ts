// Sprig Connector
// TypeScript wrapper for Sprig user management and survey export APIs

export { Sprig } from './api';
export * from './types';

export {
  SprigClient,
  UsersApi,
  PurgeApi,
  SurveysApi,
  ResponsesApi,
  ThemesApi,
} from './api';

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
  getConfigDir,
} from './utils/config';
