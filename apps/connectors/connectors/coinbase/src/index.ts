// Coinbase Connector
// TypeScript wrapper for Coinbase cryptocurrency API

export { Coinbase } from './api';
export * from './types';
export { CoinbaseClient } from './api';

export {
  getApiKey,
  setApiKey,
  getApiSecret,
  setApiSecret,
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
