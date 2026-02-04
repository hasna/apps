// Stripe Connector API
// A TypeScript wrapper for the Stripe API

export { Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ConnectorClient,
  BalanceApi,
  ProductsApi,
  PricesApi,
  CustomersApi,
  SubscriptionsApi,
  SubscriptionItemsApi,
  PaymentIntentsApi,
  PaymentMethodsApi,
  ChargesApi,
  InvoicesApi,
  InvoiceItemsApi,
  CouponsApi,
  PromotionCodesApi,
  EventsApi,
  WebhooksApi,
  CheckoutSessionsApi,
  PaymentLinksApi,
  BillingPortalApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getApiSecret,
  setApiSecret,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
