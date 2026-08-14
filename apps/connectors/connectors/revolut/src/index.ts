// Revolut Business API Connector
// TypeScript wrapper for Revolut Business API

export { Revolut } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  RevolutClient,
  AccountsApi,
  CounterpartiesApi,
  PaymentsApi,
  TransactionsApi,
  ExchangeApi,
  CardsApi,
} from './api';

// Export config utilities
export {
  getApiToken,
  setApiToken,
  getSandbox,
  setSandbox,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
