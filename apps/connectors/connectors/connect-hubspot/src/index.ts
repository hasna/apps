// HubSpot Connector
// TypeScript wrapper for HubSpot CRM contacts, companies, deals, and tickets API

export { HubSpot } from './api';
export * from './types';
export { HubSpotClient } from './api';

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
