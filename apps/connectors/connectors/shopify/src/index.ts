// Shopify Connector
// TypeScript wrapper for Shopify Admin API

export { Shopify } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ShopifyClient,
  ProductsApi,
  OrdersApi,
  CustomersApi,
  InventoryApi,
  CollectionsApi,
  ShopApi,
} from './api';

// Export config utilities
export {
  getStore,
  setStore,
  getAccessToken,
  setAccessToken,
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
  normalizeStoreName,
} from './utils/config';
