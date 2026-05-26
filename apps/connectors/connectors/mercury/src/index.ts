// Mercury Banking API
// TypeScript client for Mercury's banking API

export { Mercury } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  MercuryClient,
  AccountsApi,
  TransactionsApi,
  RecipientsApi,
  TransfersApi,
  InvoicesApi,
  CustomersApi,
  TreasuryApi,
  OrganizationApi,
  WebhooksApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
