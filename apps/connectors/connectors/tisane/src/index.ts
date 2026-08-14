// Tisane NLP API Connector

export { Tisane, Connector } from './api';
export * from './types';

export { TisaneClient, NlpApi } from './api';

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
} from './utils/config';
