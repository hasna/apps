// Plaid Connector
// TypeScript wrapper for Plaid financial data API

export { Plaid } from './api';
export * from './types';
export { PlaidClient } from './api';

export {
  getClientId,
  setClientId,
  getSecret,
  setSecret,
  getBaseUrl,
  setBaseUrl,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
