// Stripe Reporting (Advanced) Connector
// A TypeScript wrapper for the Stripe Reporting API
// https://docs.stripe.com/api/reporting

export { Connector, StripeReporting } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ConnectorClient,
  ReportTypesApi,
  ReportRunsApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  getApiVersion,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
