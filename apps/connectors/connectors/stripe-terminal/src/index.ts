export { Connector, Connector as StripeTerminal } from './api';
export * from './types';

export {
  ConnectorClient,
  ConnectionTokensApi,
  LocationsApi,
  ReadersApi,
  ConfigurationsApi,
} from './api';

export {
  getApiKey,
  setApiKey,
  getAccountId,
  setAccountId,
  getApiVersion,
  setApiVersion,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
