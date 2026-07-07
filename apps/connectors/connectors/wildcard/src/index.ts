export { Wildcard, WildcardClient, SearchApi, QueryApi, FlowsApi } from './api';
export * from './types';

export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getDefaultCollectionId,
  setDefaultCollectionId,
  getProviderAuthJson,
  setProviderAuthJson,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getWildcardConfig,
} from './utils/config';
