// Typless API Connector

export { Connector } from './api';
export * from './types';

export {
  ConnectorClient,
  ExtractionApi,
  TrainingApi,
  RawApi,
} from './api';

export {
  getApiKey,
  setApiKey,
  getApiSecret,
  setApiSecret,
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
