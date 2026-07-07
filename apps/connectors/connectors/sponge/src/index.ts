// Sponge Connector
// TypeScript client for the public PaySponge Agent Wallet API.

export { Sponge } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  SpongeClient,
  AgentsApi,
  WalletsApi,
  TransfersApi,
  PaymentsApi,
  TradingApi,
  OnrampApi,
  CardsApi,
  KeysApi,
  RawApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
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
  getConfigDir,
} from './utils/config';
