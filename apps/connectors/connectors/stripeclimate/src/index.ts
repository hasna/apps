// Stripe Climate Connector API
// A TypeScript wrapper for the public Stripe Climate API
// https://docs.stripe.com/api/climate

export { Connector, Connector as StripeClimate } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { ConnectorClient, ProductsApi, SuppliersApi, OrdersApi } from './api';

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
