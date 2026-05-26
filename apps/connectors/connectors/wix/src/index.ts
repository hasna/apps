// Wix Connector
// TypeScript wrapper for Wix REST APIs

export { Wix } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  WixClient,
  SitesApi,
  ContactsApi,
  MembersApi,
  ProductsApi,
  OrdersApi,
  InventoryApi,
  BookingsApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getSiteId,
  setSiteId,
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
