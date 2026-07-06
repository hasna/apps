// Sysdig Connector API
// A TypeScript wrapper for Sysdig's REST API (Monitor / Secure / Platform)

export { Sysdig } from './api';
export * from './types';

// Re-export client for advanced usage
export { SysdigClient, REGIONS, DEFAULT_REGION, resolveBaseUrl } from './api';

// Export config utilities
export {
  getApiToken,
  setApiToken,
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
} from './utils/config';
