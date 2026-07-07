// StackAdapt programmatic advertising API connector

export { Connector, ConnectorClient, CampaignsApi, EventsApi, DEFAULT_REST_BASE_URL, DEFAULT_GRAPHQL_URL } from './api';
export * from './types';

export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  getGraphqlUrl,
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
