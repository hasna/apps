// Sucuri Connector API
// A TypeScript wrapper for the Sucuri Scanning API

export { Sucuri } from './api';
export * from './types';

// Re-export the low-level client for advanced usage
export { DEFAULT_SCAN_FORMAT, DEFAULT_TIMEOUT_MS, SucuriClient } from './api';
export type { ScanRequestOptions } from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getMonitorDomain,
  setMonitorDomain,
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

// Export output utilities
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
