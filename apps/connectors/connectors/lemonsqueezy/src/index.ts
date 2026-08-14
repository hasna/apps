// Lemon Squeezy Connector
// TypeScript wrapper for Lemon Squeezy digital products, subscriptions, and license keys API

export { LemonSqueezy } from './api';
export * from './types';
export { LemonSqueezyClient } from './api';

export {
  getApiKey,
  setApiKey,
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
