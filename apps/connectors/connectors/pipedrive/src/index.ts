// Pipedrive Connector
// TypeScript wrapper for Pipedrive CRM persons, organizations, deals, and activities API

export { Pipedrive } from './api';
export * from './types';
export { PipedriveClient } from './api';

export {
  getApiKey,
  setApiKey,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
