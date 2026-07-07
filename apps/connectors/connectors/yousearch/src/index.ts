// You.com Search API Connector
// A TypeScript wrapper for You.com Search and Research APIs

export { YouSearch } from './api';
export * from './types';

export { YouSearchClient, SearchApi, ResearchApi, DEFAULT_BASE_URL } from './api';

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
