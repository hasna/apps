// Stripe Atlas Connector
// Browser automation for Stripe Atlas dashboard (no public API)

export { StripeAtlas, Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { StripeAtlasClient, ConnectorClient } from './api/client';
export { StripeAtlasApi, ExampleApi } from './api/example';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getApiSecret,
  setApiSecret,
  getEmail,
  setEmail,
  getPassword,
  setPassword,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
