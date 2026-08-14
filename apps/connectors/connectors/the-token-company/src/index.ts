// The Token Company API Connector
// LLM prompt compression middleware

export { TheTokenCompany, Connector } from './api';
export * from './types';

export { TheTokenCompanyClient, CompressApi } from './api';

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
