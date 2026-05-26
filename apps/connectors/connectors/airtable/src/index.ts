// Airtable Connector
// A TypeScript wrapper for the Airtable API

export { Airtable } from './api';
export { AirtableClient } from './api/client';
export * from './types';

// Export config utilities
export {
  getAccessToken,
  setAccessToken,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
