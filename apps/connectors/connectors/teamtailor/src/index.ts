// Teamtailor API Connector
// A TypeScript wrapper for the Teamtailor Public API (JSON:API) with
// multi-profile support.

export { Teamtailor } from './api';
export * from './types';

// Re-export the client and generic resource wrapper for advanced usage
export {
  TeamtailorClient,
  ResourceApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getApiVersion,
  setApiVersion,
  getBaseUrl,
  setBaseUrl,
  isAuthenticated,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
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
