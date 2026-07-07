// TheHiveProject API Connector
// Security case management platform for self-hosted TheHive instances.

export { TheHiveProject } from './api';
export * from './types';

export {
  TheHiveProjectClient,
  API_PATH_PREFIX,
  CasesApi,
  CustomEventsApi,
  EventsApi,
  QueryApi,
  SearchApi,
} from './api';

export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getOrganisation,
  setOrganisation,
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
