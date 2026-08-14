// USPTO Connector
// A TypeScript wrapper for USPTO APIs with browser automation

export { USPTO } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { USPTOClient, PatentsApi, TrademarksApi, PTABApi, BrowserApi } from './api';

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
