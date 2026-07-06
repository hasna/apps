// TheHiveProject API Connector
// Security case management platform — https://api.thehive-project.com/v1

export { TheHiveProject } from './api';
export * from './types';

export {
  TheHiveProjectClient,
  DEFAULT_BASE_URL,
  CasesApi,
  EventsApi,
  SearchApi,
} from './api';

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
} from './utils/config';

export {
  formatOutput,
  success,
  error,
  warn,
  info,
  print,
  type OutputFormat,
} from './utils/output';
