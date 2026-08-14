// The Trade Desk API Connector

export { TheTradeDesk, createConnector, ConnectorClient, DEFAULT_BASE_URL } from './api';
export type { CampaignsApi, EventsApi, SearchApi } from './api';
export * from './types';

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
  getActiveProfileName,
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
