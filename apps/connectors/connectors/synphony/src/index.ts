// Synphony API Connector

export { Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { ConnectorClient, SynphonyApi } from './api';

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
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
  getActiveProfileName,
  type ProfileConfig,
} from './utils/config';

// Export settings utilities
export {
  loadSettings,
  saveSettings,
  getSetting,
  setSetting,
  resetSettings,
  getDefaultSettings,
  isVerbose,
  needsConfirmation,
  type Settings,
} from './utils/settings';

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
