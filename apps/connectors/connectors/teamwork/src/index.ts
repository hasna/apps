// Teamwork API Connector

export { Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ConnectorClient,
  ProjectsApi,
  TasksApi,
  TasklistsApi,
  MilestonesApi,
  PeopleApi,
  CompaniesApi,
  TimeApi,
  CommentsApi,
  V3,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getInstallation,
  setInstallation,
  getBaseUrl,
  setBaseUrl,
  getToken,
  setToken,
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
