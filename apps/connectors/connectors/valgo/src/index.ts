// Valgo API Connector

export { Connector } from './api';
export * from './types';

export {
  ConnectorClient,
  SimulationsApi,
  RoutesApi,
  EnvironmentsApi,
  RawApi,
  DEFAULT_BASE_URL,
  encodePathSegment,
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
  heading,
  print,
  setVerboseMode,
  isVerboseMode,
  debug,
  debugRequest,
  debugResponse,
  type OutputFormat,
} from './utils/output';
