// Speakeasy API Connector

export { Connector } from './api';
export * from './types';

export {
  ConnectorClient,
  DEFAULT_BASE_URL,
  AuthApi,
  ApisApi,
  EndpointsApi,
  MetadataApi,
  SchemasApi,
  EventlogApi,
  EmbedsApi,
  EventsApi,
} from './api';

export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  getWorkspaceId,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
  buildConnectorConfig,
  setProfileOverride,
  profileExists,
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
