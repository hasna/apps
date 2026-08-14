// Splunk Cloud Platform Connector
// Manage search jobs, saved searches, indexes, HEC tokens, users, roles, and alerts
// via the splunkd REST management API.

export { SplunkCloud } from './api';
export { SplunkCloudClient } from './api/client';
export type { ListParams } from './api';
export * from './types';

// Config utilities
export {
  getBaseUrl,
  setBaseUrl,
  getToken,
  setToken,
  getUsername,
  getPassword,
  setBasicAuth,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
  getActiveProfileName,
  setProfileOverride,
} from './utils/config';

// Output utilities
export { formatOutput, print } from './utils/output';
