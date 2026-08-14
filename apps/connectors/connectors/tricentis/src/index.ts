// Tricentis Connector
// TypeScript wrapper for the Tricentis test automation platform API

export { Tricentis, TricentisClient, DEFAULT_BASE_URL } from './api';
export * from './types';

export {
  getApiKey,
  setApiKey,
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
} from './utils/config';

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
