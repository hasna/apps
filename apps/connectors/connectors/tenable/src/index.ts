// @hasna/connect-tenable
// A TypeScript client + CLI for the Tenable Vulnerability Management (Tenable.io) REST API.

export { Tenable, TenableClient } from './api';
export * from './types';

// Config / profile utilities
export {
  getAccessKey,
  setAccessKey,
  getSecretKey,
  setSecretKey,
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
  type ProfileConfig,
} from './utils/config';

// Settings utilities
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

// Local storage utilities
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

// Bulk operation utilities
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

// Output utilities
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
