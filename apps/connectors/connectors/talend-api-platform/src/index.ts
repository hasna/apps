// Talend API Platform Connector
// A TypeScript wrapper for the Talend Cloud Management Console Public API.

export { TalendApiPlatform, TalendClient } from './api';
export * from './types';

// Config utilities
export {
  getToken,
  setToken,
  getRegion,
  setRegion,
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
  type ProfileConfig,
} from './utils/config';

// Output utilities
export {
  formatOutput,
  print,
  success,
  error,
  warn,
  info,
  heading,
  type OutputFormat,
} from './utils/output';
