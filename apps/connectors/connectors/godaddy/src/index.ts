// GoDaddy API Connector
// A TypeScript wrapper for the GoDaddy API with multi-profile support

export { GoDaddy } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  GoDaddyClient,
  DomainsApi,
  DnsApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getApiSecret,
  setApiSecret,
  setCredentials,
  isAuthenticated,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
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
