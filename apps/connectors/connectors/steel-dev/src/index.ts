// Steel Dev Connector
// TypeScript wrapper for the Steel cloud browser API

export { SteelDev } from './api';
export * from './types';

export { SteelDevClient, SessionsApi, SearchApi } from './api';

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
