// PayPal Connector
// TypeScript wrapper for PayPal payments API

export { PayPal } from './api';
export * from './types';
export { PayPalClient } from './api';

export {
  getClientId,
  setClientId,
  getClientSecret,
  setClientSecret,
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
