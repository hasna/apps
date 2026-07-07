// Stripe Connect Platform Connector
// Platform operations for Stripe Connect: accounts, onboarding, transfers, and fees

export { Connector, Connector as StripeConnectPlatform } from './api';
export * from './types';

export {
  ConnectorClient,
  AccountsApi,
  AccountLinksApi,
  LoginLinksApi,
  TransfersApi,
  ApplicationFeesApi,
  RawRequestApi,
} from './api';

export {
  getApiKey,
  setApiKey,
  getAccountId,
  setAccountId,
  getConnectedAccountId,
  setConnectedAccountId,
  getApiVersion,
  getBaseUrl,
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
