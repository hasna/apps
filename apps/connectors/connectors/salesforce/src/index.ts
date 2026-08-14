// Salesforce Connector
// TypeScript wrapper for Salesforce CRM accounts, contacts, leads, and opportunities API

export { Salesforce } from './api';
export * from './types';
export { SalesforceClient } from './api';

export {
  getAccessToken,
  setAccessToken,
  getInstanceUrl,
  setInstanceUrl,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
