// The Company Company API Connector

export { Connector } from './api';
export * from './types';

export {
  ConnectorClient,
  DEFAULT_BASE_URL,
  AgentsApi,
  TasksApi,
  IntegrationsApi,
  MemoriesApi,
  EventsApi,
} from './api';

export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';

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
