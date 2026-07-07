// Stripe Identity Connector API
// A TypeScript wrapper for the Stripe Identity API

export { Connector, Connector as StripeIdentity } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ConnectorClient,
  VerificationSessionsApi,
  VerificationReportsApi,
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
