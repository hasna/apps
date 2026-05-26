// Maropost API Connector
// A TypeScript wrapper for Maropost Marketing Cloud API

export { Maropost, Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  MaropostClient,
  ConnectorClient,
  ContactsApi,
  ListsApi,
  CampaignsApi,
  ReportsApi,
  JourneysApi,
  TransactionalApi,
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
