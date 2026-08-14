// You.com API Connector
// Web Search and Research API client for You.com

export { YouCom } from './api';
export * from './types';

export { YouComClient, SearchApi, ResearchApi } from './api';

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
