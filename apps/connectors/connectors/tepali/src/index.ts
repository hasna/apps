// Tepali API Connector

export { Tepali } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ConnectorClient,
  DEFAULT_BASE_URL,
  PatientsApi,
  AppointmentsApi,
  TreatmentsApi,
  ChartsApi,
  InventoryApi,
  LeadsApi,
  type RequestOptions,
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
  ensureConfigDir,
  setProfileOverride,
  type ProfileConfig,
} from './utils/config';

// Export auth utilities
export {
  resolveCredentials,
  buildConfig,
  buildAuthHeader,
  type ResolvedCredentials,
} from './utils/auth';

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
  type OutputFormat,
} from './utils/output';
