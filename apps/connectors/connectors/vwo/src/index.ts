export { Connector } from './api';
export * from './types';

export {
  ConnectorClient,
  AccountApi,
  CampaignsApi,
  GoalsApi,
  SegmentsApi,
  FeatureFlagsApi,
  EnvironmentsApi,
  MetricsApi,
  SurveysApi,
  HeatmapsApi,
  SessionRecordingsApi,
  WebhooksApi,
  AuditLogApi,
  UsersApi,
} from './api';

export {
  getApiToken,
  setApiToken,
  getAccountId,
  setAccountId,
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
  setProfileOverride,
} from './utils/config';

export {
  formatOutput,
  success,
  error,
  warn,
  info,
  print,
  setVerboseMode,
  isVerboseMode,
  debug,
  type OutputFormat,
} from './utils/output';
