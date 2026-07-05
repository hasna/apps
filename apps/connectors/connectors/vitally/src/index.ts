export { Vitally } from './api';
export * from './types';
export { VitallyClient, buildBasicAuthHeader, resolveBaseUrl } from './api';

export {
  getApiKey,
  setApiKey,
  getSubdomain,
  setSubdomain,
  getRegion,
  setRegion,
  getBaseUrl,
  buildVitallyConfig,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
