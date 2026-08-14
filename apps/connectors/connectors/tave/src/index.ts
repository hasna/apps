// Tave API Connector

export { Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ConnectorClient,
  ContactsApi,
  JobsApi,
  LeadsApi,
  OrdersApi,
  RawApi,
} from './api';

// Export config utilities
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
  profileExists,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
  setProfileOverride,
} from './utils/config';

// Export output utilities
export {
  formatOutput,
  success,
  error,
  warn,
  info,
  heading,
  print,
  setVerboseMode,
  isVerboseMode,
  debug,
  debugRequest,
  debugResponse,
  type OutputFormat,
} from './utils/output';
