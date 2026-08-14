// Taboola Backstage API Connector
// A TypeScript wrapper for the Taboola Backstage advertising API

export { Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ConnectorClient,
  AccountApi,
  CampaignsApi,
  CampaignItemsApi,
  ReportsApi,
  AudiencesApi,
} from './api';

// Export config utilities
export {
  getCredentials,
  setCredentials,
  getAccessToken,
  setAccessToken,
  getAccountId,
  setAccountId,
  loadTokens,
  saveTokens,
  clearTokens,
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

// Export OAuth2 utilities
export {
  fetchAccessToken,
  getValidAccessToken,
  isAuthenticated,
} from './utils/auth';

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

// Export storage utilities
export {
  saveEntity,
  getEntity,
  entityExists,
  getAllEntities,
  deleteEntity,
  searchEntities,
  searchEntitiesByText,
  countEntities,
  clearEntities,
  createStorage,
  type Storable,
} from './utils/storage';

// Export bulk operation utilities
export {
  executeBulk,
  executeSequential,
  chunkArray,
  sleep,
  createProgressReporter,
  formatBulkResult,
  type BulkOperationOptions,
  type BulkOperationResult,
} from './utils/bulk';

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
