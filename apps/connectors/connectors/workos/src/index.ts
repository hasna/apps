// WorkOS Connector
// TypeScript wrapper for the WorkOS REST API

export { WorkOS, WorkOSClient, DEFAULT_BASE_URL } from './api';
export * from './types';

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
  getConfigDir,
  setProfileOverride,
  profileExists,
  getActiveProfileName,
} from './utils/config';

export {
  formatOutput,
  success,
  error,
  warn,
  info,
  heading,
  print,
  type OutputFormat,
} from './utils/output';
