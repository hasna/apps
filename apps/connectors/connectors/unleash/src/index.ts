// Unleash feature flag connector API

export { Connector } from './api';
export * from './types';

export { ConnectorClient, FlagsApi, EventsApi, DEFAULT_BASE_URL, DEFAULT_PROJECT_ID } from './api';

export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getProjectId,
  setProjectId,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getToken,
  setToken,
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
