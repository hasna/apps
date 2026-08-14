// Stamped.io Connector
// TypeScript wrapper for the Stamped.io reviews, customers, and loyalty API.

export { Stampedio } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { StampedioClient, ReviewsApi, CustomersApi, LoyaltyApi } from './api';

// Config utilities
export {
  getPublicKey,
  setPublicKey,
  getPrivateKey,
  setPrivateKey,
  getStoreHash,
  setStoreHash,
  getStoreUrl,
  setStoreUrl,
  hasCredentials,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
  setProfileOverride,
  type ProfileConfig,
} from './utils/config';

// Output utilities
export {
  formatOutput,
  success,
  error,
  warn,
  info,
  heading,
  print,
  truncate,
  type OutputFormat,
} from './utils/output';
