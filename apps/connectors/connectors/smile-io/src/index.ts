// Smile.io Connector
// TypeScript wrapper for the Smile.io loyalty & rewards REST API.

export { Smile } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  SmileClient,
  CustomersApi,
  CustomerIdentitiesApi,
  PointsTransactionsApi,
  PointsProductsApi,
  ActivitiesApi,
  EarningRulesApi,
  VipTiersApi,
  PointsSettingsApi,
  RewardFulfillmentsApi,
} from './api';

// Config utilities
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
  profileExists,
  clearConfig,
  getConfigDir,
  getActiveProfileName,
} from './utils/config';

// Output utilities
export { formatOutput, print, success, error, warn, info } from './utils/output';
export type { OutputFormat } from './utils/output';
