// WIPO Connector
// A TypeScript wrapper for WIPO APIs with browser automation

export { WIPO } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { WIPOClient, PatentscopeApi, MadridApi, PearlApi, BrowserApi } from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getHeadless,
  setHeadless,
  getBrowser,
  setBrowser,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
