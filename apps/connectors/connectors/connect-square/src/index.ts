// Square Connector
// TypeScript wrapper for Square payments, orders, customers, and catalog API

export { Square } from './api';
export * from './types';
export { SquareClient } from './api';

export {
  getAccessToken,
  setAccessToken,
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
