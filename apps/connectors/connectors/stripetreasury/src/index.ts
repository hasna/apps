// Stripe Treasury Connector API
// A TypeScript wrapper for the Stripe Treasury API

export { Connector, Connector as StripeTreasury } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ConnectorClient,
  FinancialAccountsApi,
  TransactionsApi,
  TransactionEntriesApi,
  OutboundPaymentsApi,
  OutboundTransfersApi,
  InboundTransfersApi,
  ReceivedCreditsApi,
  ReceivedDebitsApi,
  CreditReversalsApi,
  DebitReversalsApi,
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
