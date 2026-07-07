// Stripe Capital Connector
// A TypeScript wrapper for the Stripe Capital API (Capital for platforms).

export { Connector, Connector as StripeCapital } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ConnectorClient,
  FinancingOffersApi,
  FinancingSummaryApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
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
} from './utils/config';
