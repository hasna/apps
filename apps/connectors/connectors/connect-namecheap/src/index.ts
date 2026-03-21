// Namecheap Connector API
// A TypeScript wrapper for the Namecheap XML API

export { Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ConnectorClient,
  DomainsApi,
  DnsApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getUsername,
  setUsername,
  getClientIp,
  setClientIp,
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
