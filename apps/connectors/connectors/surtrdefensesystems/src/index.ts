// Surtr Defense Systems Connector
// TypeScript wrapper for the Surtr counter-UAS operating system:
// sensors, threat fusion, situation picture, and engagements.

export { Surtr, SurtrClient, DEFAULT_BASE_URL } from './api';
export * from './types';

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
