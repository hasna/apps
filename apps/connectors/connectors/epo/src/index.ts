// EPO OPS Connector
// A TypeScript wrapper for the European Patent Office Open Patent Services API

export { EPO } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { EPOClient, PublicationsApi, FamilyApi, LegalApi, RegisterApi, ClassificationApi } from './api';

// Export config utilities
export {
  getConsumerKey,
  getConsumerSecret,
  setCredentials,
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
